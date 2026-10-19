import { asc, eq, inArray } from 'drizzle-orm';
import {
  CONTACT_VISIBLE_STATUSES,
  OFFER_TIMEOUT_S,
  availableEvents,
  type FarmerBookingView,
  type OfferView,
  type TimelineEntry,
  type VetJobView,
  type WardView,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import {
  bookingEvents,
  bookingOffers,
  bookings,
  farmers,
  locations,
  ratings,
  treatments,
  users,
  vets,
} from '../../db/schema/index.js';
import { photoUrls } from '../media/service.js';
import { depositStates } from '../payments/service.js';
import { vetPrice } from './pricing.js';
import type { BookingRow } from './transitions.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function wardsById(
  db: Db,
  ids: number[],
): Promise<Map<number, WardView & { lat: number | null; lng: number | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(locations)
    .where(inArray(locations.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, ward: r.ward, subCounty: r.subCounty, county: r.county, lat: r.lat, lng: r.lng },
    ]),
  );
}

function wardView(w: WardView | undefined, id: number): WardView {
  return w
    ? { id: w.id, ward: w.ward, subCounty: w.subCounty, county: w.county }
    : { id, ward: '', subCounty: '', county: '' };
}

async function timelines(db: Db, bookingIds: number[]): Promise<Map<number, TimelineEntry[]>> {
  const out = new Map<number, TimelineEntry[]>();
  if (bookingIds.length === 0) return out;
  const rows = await db
    .select()
    .from(bookingEvents)
    .where(inArray(bookingEvents.bookingId, bookingIds))
    .orderBy(asc(bookingEvents.id));
  for (const r of rows) {
    const list = out.get(r.bookingId) ?? [];
    list.push({ event: r.event, status: r.toStatus, at: r.createdAt.toISOString() });
    out.set(r.bookingId, list);
  }
  return out;
}

/** Farmer-facing views of their own bookings (batch, for lists). */
export async function farmerViews(
  ctx: Pick<AppContext, 'db' | 'storage'>,
  rows: BookingRow[],
): Promise<FarmerBookingView[]> {
  const db = ctx.db;
  const ids = rows.map((b) => b.id);
  const vetIds = [...new Set(rows.map((b) => b.vetId).filter((v): v is string => v !== null))];
  const [wards, times, vetRows, treatmentRows, ratingRows, deposits] = await Promise.all([
    wardsById(
      db,
      rows.map((b) => b.wardId),
    ),
    timelines(db, ids),
    vetIds.length
      ? db
          .select({
            userId: vets.userId,
            type: vets.type,
            rating: vets.rating,
            name: users.name,
            displayName: users.displayName,
            avatarMediaId: users.avatarMediaId,
            phone: users.phone,
          })
          .from(vets)
          .innerJoin(users, eq(users.id, vets.userId))
          .where(inArray(vets.userId, vetIds))
      : Promise.resolve([]),
    ids.length
      ? db.select().from(treatments).where(inArray(treatments.bookingId, ids))
      : Promise.resolve([]),
    ids.length
      ? db.select().from(ratings).where(inArray(ratings.bookingId, ids))
      : Promise.resolve([]),
    depositStates({ db }, ids),
  ]);
  const vetById = new Map(vetRows.map((v) => [v.userId, v]));
  const photos = await photoUrls(
    ctx,
    vetRows.map((v) => v.avatarMediaId),
  );
  const treatmentByBooking = new Map(treatmentRows.map((t) => [t.bookingId, t]));
  const ratingByBooking = new Map(ratingRows.map((r) => [r.bookingId, r]));

  return rows.map((b) => {
    const vet = b.vetId ? vetById.get(b.vetId) : undefined;
    const treatment = treatmentByBooking.get(b.id);
    const rating = ratingByBooking.get(b.id);
    const contactVisible = CONTACT_VISIBLE_STATUSES.includes(b.status);
    return {
      id: b.id,
      status: b.status,
      species: b.species,
      problemType: b.problemType,
      note: b.note,
      isEmergency: b.isEmergency,
      sourceChannel: b.sourceChannel,
      ward: wardView(wards.get(b.wardId), b.wardId),
      feeQuoted: b.feeQuoted,
      depositKes: b.bookingFeeKes,
      services: b.services,
      priceRange: b.priceRange ?? null,
      price: b.vetPrice ?? null,
      deposit: deposits.get(b.id) ?? { status: 'none', receipt: null, paymentId: null },
      createdAt: b.createdAt.toISOString(),
      acceptedAt: iso(b.acceptedAt),
      completedAt: iso(b.completedAt),
      timeline: times.get(b.id) ?? [],
      vet: vet
        ? {
            name: vet.name,
            displayName: vet.displayName,
            photoUrl: (vet.avatarMediaId && photos.get(vet.avatarMediaId)) ?? null,
            type: vet.type,
            rating: vet.rating === null ? null : Number(vet.rating),
            phone: contactVisible ? vet.phone : null,
          }
        : null,
      treatment: treatment
        ? {
            diagnosis: treatment.diagnosis,
            drugsUsed: treatment.drugsUsed,
            followUpDate: treatment.followUpDate,
          }
        : null,
      rating: rating ? { stars: rating.stars, comment: rating.comment } : null,
      actions: availableEvents(b.status, 'farmer'),
    };
  });
}

/** Views of jobs assigned to a vet (batch). */
export async function vetJobViews(
  ctx: Pick<AppContext, 'db' | 'storage'>,
  rows: BookingRow[],
): Promise<VetJobView[]> {
  const db = ctx.db;
  const ids = rows.map((b) => b.id);
  const farmerIds = [...new Set(rows.map((b) => b.farmerId))];
  const [wards, times, farmerRows] = await Promise.all([
    wardsById(
      db,
      rows.map((b) => b.wardId),
    ),
    timelines(db, ids),
    farmerIds.length
      ? db
          .select({
            userId: farmers.userId,
            farmNotes: farmers.farmNotes,
            name: users.name,
            displayName: users.displayName,
            avatarMediaId: users.avatarMediaId,
            phone: users.phone,
          })
          .from(farmers)
          .innerJoin(users, eq(users.id, farmers.userId))
          .where(inArray(farmers.userId, farmerIds))
      : Promise.resolve([]),
  ]);
  const farmerById = new Map(farmerRows.map((f) => [f.userId, f]));
  const photos = await photoUrls(
    ctx,
    farmerRows.map((f) => f.avatarMediaId),
  );
  return rows.map((b) => {
    const ward = wards.get(b.wardId);
    const farmer = farmerById.get(b.farmerId);
    const contactVisible = CONTACT_VISIBLE_STATUSES.includes(b.status);
    let location: VetJobView['location'] = null;
    if (b.lat !== null && b.lng !== null) location = { lat: b.lat, lng: b.lng, precise: true };
    else if (ward?.lat != null && ward.lng != null) {
      location = { lat: ward.lat, lng: ward.lng, precise: false };
    }
    return {
      id: b.id,
      status: b.status,
      species: b.species,
      problemType: b.problemType,
      note: b.note,
      isEmergency: b.isEmergency,
      ward: wardView(ward, b.wardId),
      location,
      feeQuoted: b.feeQuoted,
      services: b.services,
      price: b.vetPrice ?? null,
      acceptedAt: iso(b.acceptedAt),
      completedAt: iso(b.completedAt),
      timeline: times.get(b.id) ?? [],
      farmer: {
        name: farmer?.name ?? null,
        displayName: farmer?.displayName ?? null,
        photoUrl: (farmer?.avatarMediaId && photos.get(farmer.avatarMediaId)) ?? null,
        phone: contactVisible ? (farmer?.phone ?? null) : null,
        farmNotes: contactVisible ? (farmer?.farmNotes ?? null) : null,
      },
      actions: availableEvents(b.status, 'vet'),
    };
  });
}

/** Open offers for a vet: still unanswered (or timed out) on bookings that are still pending. */
export async function openOffersFor(db: Db, vetUserId: string): Promise<OfferView[]> {
  const rows = await db
    .select({ offer: bookingOffers, booking: bookings })
    .from(bookingOffers)
    .innerJoin(bookings, eq(bookings.id, bookingOffers.bookingId))
    .where(eq(bookingOffers.vetId, vetUserId))
    .orderBy(asc(bookingOffers.sentAt));
  const open = rows.filter(
    (r) =>
      r.booking.status === 'pending' &&
      (r.offer.response === null || r.offer.response === 'timeout'),
  );
  const wards = await wardsById(
    db,
    open.map((r) => r.booking.wardId),
  );
  // What each job pays at the vet's current prices (§24.3); fixed when they accept.
  const prices = await Promise.all(
    open.map((r) => vetPrice(db, vetUserId, r.booking.services, r.booking.bookingFeeKes)),
  );
  return open.map(({ offer, booking }, i) => {
    const timeoutS = booking.isEmergency ? OFFER_TIMEOUT_S.emergency : OFFER_TIMEOUT_S.normal;
    return {
      offerId: offer.id,
      bookingId: booking.id,
      species: booking.species,
      problemType: booking.problemType,
      isEmergency: booking.isEmergency,
      ward: wardView(wards.get(booking.wardId), booking.wardId),
      feeQuoted: booking.feeQuoted,
      services: booking.services,
      price: prices[i] ?? null,
      wave: offer.wave,
      sentAt: offer.sentAt.toISOString(),
      expiresAt: new Date(offer.sentAt.getTime() + timeoutS * 1000).toISOString(),
    };
  });
}
