import { and, asc, count, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  VET_BUSY_STATUSES,
  type BookingEvent,
  type PriceBreakdown,
  type Species,
  type VetBadge,
  type VetService,
  type VetType,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, locations, users, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { getConfig } from '../config/service.js';
import { rankCandidates, type BookingTarget } from '../matching/candidates.js';
import { photoUrls } from '../media/service.js';
import { afterCommit } from './effects.js';
import { vetPrices } from './pricing.js';
import { createOffer } from './service.js';
import { transition, type BookingRow } from './transitions.js';

/**
 * The farmer chooses the vet (§24.6). The list, the direct request to one vet, choosing again,
 * switching to waves, and the clocks that move a booking on when nobody acts.
 */

export const VET_LIST_LIMIT = 20;
export type VetSort = 'distance' | 'rating' | 'price';

export interface ChoosableVet {
  vetId: string;
  name: string | null;
  displayName: string | null;
  photoUrl: string | null;
  type: VetType;
  badges: VetBadge[];
  rating: number | null;
  /** Whole km from the vet's base or clinic (0 = under 1 km). Never live location (§17). */
  distanceKm: number;
  price: PriceBreakdown;
  languages: string[];
  yearsExperience: number | null;
}

/** Vets the farmer may choose for this request, from the same rules as matching (§8.5). */
export async function choosableVets(
  ctx: AppContext,
  target: BookingTarget & { services: readonly VetService[] },
  options: { excludeVetIds?: readonly string[]; sort?: VetSort; bookingFee: number },
): Promise<ChoosableVet[]> {
  const radiusKm = await getConfig(ctx, 'matching.maxRadiusKm');
  const ranked = await rankCandidates(ctx, target, {
    radiusKm,
    excludeVetIds: options.excludeVetIds ?? [],
    useLiveLocation: false,
  });
  if (ranked.length === 0) return [];
  const ids = ranked.map((r) => r.vetId);
  const [prices, rows] = await Promise.all([
    vetPrices(ctx.db, ids, target.services, options.bookingFee),
    ctx.db
      .select({
        vet: vets,
        name: users.name,
        displayName: users.displayName,
        avatar: users.avatarMediaId,
      })
      .from(vets)
      .innerJoin(users, eq(users.id, vets.userId))
      .where(inArray(vets.userId, ids)),
  ]);
  const photos = await photoUrls(
    ctx,
    rows.map((r) => r.avatar),
  );
  const byId = new Map(rows.map((r) => [r.vet.userId, r]));
  const list: ChoosableVet[] = [];
  for (const c of ranked) {
    const row = byId.get(c.vetId);
    const price = prices.get(c.vetId);
    if (!row || !price) continue;
    list.push({
      vetId: c.vetId,
      name: row.name,
      displayName: row.displayName,
      photoUrl: (row.avatar && photos.get(row.avatar)) ?? null,
      type: row.vet.type,
      badges: row.vet.badges,
      rating: row.vet.rating === null ? null : Number(row.vet.rating),
      distanceKm: Math.round(c.distanceKm),
      price,
      languages: row.vet.languages,
      yearsExperience: row.vet.yearsExperience,
    });
  }
  const sort = options.sort ?? 'distance';
  list.sort((a, b) =>
    sort === 'rating'
      ? (b.rating ?? -1) - (a.rating ?? -1) || a.distanceKm - b.distanceKm
      : sort === 'price'
        ? a.price.total - b.price.total || a.distanceKm - b.distanceKm
        : a.distanceKm - b.distanceKm || (b.rating ?? -1) - (a.rating ?? -1),
  );
  return list.slice(0, VET_LIST_LIMIT);
}

/** Refuse a vet who is not choosable right now (went offline, suspended, at capacity...). */
export async function assertChoosable(
  ctx: AppContext,
  target: BookingTarget & { services: readonly VetService[] },
  vetId: string,
  bookingFee: number,
  excludeVetIds: readonly string[] = [],
): Promise<void> {
  if (excludeVetIds.includes(vetId)) throw new DomainError('vet_unavailable_now');
  const list = await choosableVets(ctx, target, { excludeVetIds, bookingFee });
  if (!list.some((v) => v.vetId === vetId)) throw new DomainError('vet_unavailable_now');
}

/** Send the direct request to the chosen vet: an offer (wave 0) and a notification. */
export async function sendDirectRequest(ctx: AppContext, booking: BookingRow, vetId: string) {
  const offerId = await createOffer(ctx, {
    bookingId: booking.id,
    vetId,
    wave: 0,
    channel: 'push',
    kind: 'direct',
  });
  if (offerId === null) return;
  const [ward] = await ctx.db
    .select({ name: locations.ward })
    .from(locations)
    .where(eq(locations.id, booking.wardId));
  await ctx.jobs.add(
    'notifications.send',
    {
      userId: vetId,
      kind: 'request',
      params: { ref: booking.id, ward: ward?.name ?? '', fee: booking.feeQuoted },
      localized: { animal: booking.species, problem: booking.problemType },
      data: { bookingId: booking.id, offerId },
    },
    { jobId: `request-${booking.id}-${vetId}` },
  );
}

const targetOf = (b: BookingRow) => ({
  species: b.species as Species,
  wardId: b.wardId,
  lat: b.lat,
  lng: b.lng,
  services: b.services,
});

async function offeredVets(ctx: AppContext, bookingId: number): Promise<string[]> {
  const rows = await ctx.db
    .select({ vetId: bookingOffers.vetId })
    .from(bookingOffers)
    .where(eq(bookingOffers.bookingId, bookingId));
  return rows.map((r) => r.vetId);
}

/** The farmer's booking, or not_found. */
async function farmerBooking(ctx: AppContext, bookingId: number, farmerId: string) {
  const [b] = await ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.farmerId, farmerId)));
  if (!b) throw new DomainError('not_found');
  return b;
}

/** Vets to choose from for an existing booking (choosing again hides vets already asked). */
export async function choosableForBooking(
  ctx: AppContext,
  bookingId: number,
  farmerId: string,
  sort?: VetSort,
) {
  const b = await farmerBooking(ctx, bookingId, farmerId);
  return choosableVets(ctx, targetOf(b), {
    excludeVetIds: await offeredVets(ctx, b.id),
    bookingFee: b.bookingFeeKes,
    ...(sort && { sort }),
  });
}

/** Choose another vet after the last one declined or did not answer (§24.6 step 8). */
export async function rechoose(
  ctx: AppContext,
  input: { bookingId: number; farmerId: string; vetId: string; channel: 'app' | 'web' | 'ussd' },
): Promise<BookingRow> {
  const b = await farmerBooking(ctx, input.bookingId, input.farmerId);
  if (b.status !== 'vet_unavailable') {
    throw new DomainError('invalid_transition', { event: 'farmer_rechose', status: b.status });
  }
  await assertChoosable(
    ctx,
    targetOf(b),
    input.vetId,
    b.bookingFeeKes,
    await offeredVets(ctx, b.id),
  );
  const result = await ctx.db.transaction((tx) =>
    transition(
      tx,
      b.id,
      'farmer_rechose',
      { kind: 'farmer', userId: input.farmerId, channel: input.channel },
      ctx.clock(),
      { requestedVetId: input.vetId },
    ),
  );
  if (result.changed) await sendDirectRequest(ctx, result.booking, input.vetId);
  return result.booking;
}

/** Give up choosing: pay first and let waves find the fastest vet (§24.6 step 8). */
export async function switchToAuto(
  ctx: AppContext,
  input: { bookingId: number; farmerId: string; channel: 'app' | 'web' | 'ussd' },
): Promise<BookingRow> {
  await farmerBooking(ctx, input.bookingId, input.farmerId);
  const result = await ctx.db.transaction((tx) =>
    transition(
      tx,
      input.bookingId,
      'farmer_switched_to_auto',
      { kind: 'farmer', userId: input.farmerId, channel: input.channel },
      ctx.clock(),
    ),
  );
  await afterCommit(ctx, result, 'farmer_switched_to_auto');
  return result.booking;
}

/** How many vets this booking has asked directly (for the "try fastest available" hint). */
export async function directChoices(ctx: AppContext, bookingIds: number[]) {
  if (bookingIds.length === 0) return new Map<number, number>();
  const rows = await ctx.db
    .select({ bookingId: bookingOffers.bookingId, n: count() })
    .from(bookingOffers)
    .where(and(inArray(bookingOffers.bookingId, bookingIds), eq(bookingOffers.kind, 'direct')))
    .groupBy(bookingOffers.bookingId);
  return new Map(rows.map((r) => [r.bookingId, Number(r.n)]));
}

/** Is the vet free for one more job (counting one waiting for its booking fee)? */
export async function vetHasRoom(ctx: AppContext, vetId: string): Promise<boolean> {
  const [busy] = await ctx.db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.vetId, vetId), inArray(bookings.status, VET_BUSY_STATUSES)));
  return Number(busy?.n ?? 0) < (await getConfig(ctx, 'matching.maxActiveJobs'));
}

const DEADLINE_EVENTS: Partial<Record<BookingRow['status'], BookingEvent>> = {
  requested: 'request_timed_out',
  awaiting_deposit: 'deposit_timed_out',
  vet_unavailable: 'request_abandoned',
};

/**
 * Every minute: bookings whose clock ran out move on (§24.6). The vet did not answer → the
 * farmer chooses again; the booking fee was not paid → expired, the vet is released; nobody
 * chose again → expired. Each through the transition function, so a race with a real action
 * (an accept, a payment) leaves exactly one winner.
 */
export async function sweepDeadlines(ctx: AppContext, log: FastifyBaseLogger): Promise<number> {
  const now = ctx.clock();
  const due = await ctx.db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(
      and(
        isNotNull(bookings.statusDeadlineAt),
        lte(bookings.statusDeadlineAt, now),
        inArray(bookings.status, ['requested', 'awaiting_deposit', 'vet_unavailable']),
      ),
    )
    .orderBy(asc(bookings.statusDeadlineAt));
  let moved = 0;
  for (const row of due) {
    const event = DEADLINE_EVENTS[row.status];
    if (!event) continue;
    try {
      const result = await ctx.db.transaction(async (tx) => {
        const r = await transition(tx, row.id, event, { kind: 'system' }, now);
        if (event === 'request_timed_out' && r.changed) {
          await tx
            .update(bookingOffers)
            .set({ response: 'timeout', respondedAt: now })
            .where(
              and(
                eq(bookingOffers.bookingId, row.id),
                eq(bookingOffers.kind, 'direct'),
                eq(bookingOffers.vetId, r.booking.requestedVetId ?? ''),
              ),
            );
        }
        return r;
      });
      await afterCommit(ctx, result, event);
      moved += 1;
    } catch (err) {
      // Someone acted at the last moment (accepted, paid, cancelled): nothing to do.
      if (!(err instanceof DomainError && err.code === 'invalid_transition')) throw err;
    }
  }
  if (moved) log.info({ moved }, 'booking deadlines');
  return moved;
}
