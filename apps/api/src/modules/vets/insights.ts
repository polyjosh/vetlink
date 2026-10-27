import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { RATING_TAGS, type RatingTag, type Species } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookings, farmers, locations, ratings, treatments, users } from '../../db/schema/index.js';

/** Farmer contact shows on a follow-up only this close to its date (§24.4, §17). */
export const FOLLOW_UP_CONTACT_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

/** Today in Nairobi (EAT, UTC+3) as YYYY-MM-DD. */
export function eatDate(now: Date, plusDays = 0): string {
  return new Date(now.getTime() + 3 * 3600 * 1000 + plusDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The vet's ratings (§24.4): summary plus the latest ones. The farmer is never named, here or
 * anywhere a vet reads ratings.
 */
export async function vetRatings(ctx: AppContext, vetId: string, limit = 50) {
  const rows = await ctx.db
    .select({
      bookingId: ratings.bookingId,
      stars: ratings.stars,
      tags: ratings.tags,
      comment: ratings.comment,
      createdAt: ratings.createdAt,
      species: bookings.species,
    })
    .from(ratings)
    .innerJoin(bookings, eq(bookings.id, ratings.bookingId))
    .where(eq(bookings.vetId, vetId))
    .orderBy(desc(ratings.createdAt));
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
    '1' | '2' | '3' | '4' | '5',
    number
  >;
  const tagCounts = Object.fromEntries(RATING_TAGS.map((t) => [t, 0])) as Record<RatingTag, number>;
  for (const r of rows) {
    distribution[String(r.stars) as keyof typeof distribution] += 1;
    for (const t of r.tags) tagCounts[t] += 1;
  }
  const average = rows.length
    ? Math.round((rows.reduce((a, r) => a + r.stars, 0) / rows.length) * 10) / 10
    : null;
  return {
    average,
    count: rows.length,
    distribution,
    tagCounts,
    items: rows.slice(0, limit).map((r) => ({
      bookingId: r.bookingId,
      stars: r.stars,
      tags: r.tags,
      comment: r.comment,
      species: r.species as Species,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Follow-ups the vet set on their own treatments, from today on (§24.4). The farmer's name and
 * phone appear only within 7 days of the date; a rebooked follow-up links to its new booking.
 */
export async function vetFollowUps(ctx: AppContext, vetId: string) {
  const now = ctx.clock();
  const today = eatDate(now);
  const contactUntil = eatDate(now, FOLLOW_UP_CONTACT_DAYS);
  const rows = await ctx.db
    .select({
      treatmentId: treatments.id,
      bookingId: treatments.bookingId,
      followUpDate: treatments.followUpDate,
      diagnosis: treatments.diagnosis,
      rebookedBookingId: treatments.followUpBookingId,
      species: bookings.species,
      wardName: locations.ward,
      farmerId: bookings.farmerId,
    })
    .from(treatments)
    .innerJoin(bookings, eq(bookings.id, treatments.bookingId))
    .leftJoin(locations, eq(locations.id, bookings.wardId))
    .where(and(eq(bookings.vetId, vetId), gte(treatments.followUpDate, today)))
    .orderBy(asc(treatments.followUpDate));
  const near = rows.filter((r) => (r.followUpDate ?? '') <= contactUntil).map((r) => r.farmerId);
  const contacts = near.length
    ? await ctx.db
        .select({
          id: users.id,
          name: users.name,
          displayName: users.displayName,
          phone: users.phone,
        })
        .from(users)
        .innerJoin(farmers, eq(farmers.userId, users.id))
        .where(and(inArray(users.id, [...new Set(near)]), isNull(users.deletedAt)))
    : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = (r.followUpDate ?? '') <= contactUntil ? byId.get(r.farmerId) : undefined;
    return {
      treatmentId: r.treatmentId,
      bookingId: r.bookingId,
      followUpDate: r.followUpDate ?? today,
      // Whole days from today in Nairobi (0 = today), so clients need no clock of their own.
      daysAway: Math.round((Date.parse(r.followUpDate ?? today) - Date.parse(today)) / DAY_MS),
      species: r.species as Species,
      ward: r.wardName ?? '',
      diagnosis: r.diagnosis,
      rebookedBookingId: r.rebookedBookingId,
      farmer: c ? { name: c.displayName ?? c.name, phone: c.phone } : null,
    };
  });
}
