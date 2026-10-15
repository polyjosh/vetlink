import { and, avg, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import type {
  CancelReason,
  Channel,
  FarmerBookingView,
  ProblemType,
  Species,
  VetJobView,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import {
  animals,
  bookingOffers,
  bookings,
  farmers,
  locations,
  ratings,
  treatments,
  vets,
} from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { depositOutcomeOnCancel } from '../payments/policy.js';
import { createRefundIfPaid } from '../payments/refunds.js';
import { quoteCallOutFee } from './pricing.js';
import { transition, type BookingActor, type BookingRow } from './transitions.js';
import { farmerViews, vetJobViews } from './views.js';

/**
 * Channel-agnostic booking operations. REST, USSD (M6), SMS (M9) and admin tools all call these
 * with an actor; none of them write booking rows themselves.
 */

export interface CreateBookingInput {
  farmerId: string;
  channel: Channel;
  /** Client-generated, reused on retries (mobile generates it when the user taps). */
  idempotencyKey: string;
  species: Species;
  problemType: ProblemType;
  isEmergency: boolean;
  animalId?: string | undefined;
  note?: string | undefined;
  /** Defaults to the farmer's saved ward. */
  wardId?: number | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
}

/** Keys are scoped per farmer, so one farmer's key can never return another farmer's booking. */
const scopedKey = (farmerId: string, key: string) => `${farmerId}:${key}`;

function sameRequest(b: BookingRow, input: CreateBookingInput, wardId: number): boolean {
  return (
    b.species === input.species &&
    b.problemType === input.problemType &&
    b.isEmergency === input.isEmergency &&
    b.wardId === wardId &&
    (b.animalId ?? undefined) === input.animalId
  );
}

/**
 * Create a booking in `pending_payment`. Idempotent per (farmer, key): a retry returns the same
 * booking (`created: false`); reusing a key for a different request is refused. The fee is
 * always quoted by the server.
 */
export async function createBooking(
  ctx: AppContext,
  input: CreateBookingInput,
): Promise<{ booking: BookingRow; created: boolean }> {
  const key = scopedKey(input.farmerId, input.idempotencyKey);
  const [farmer] = await ctx.db
    .select()
    .from(farmers)
    .where(eq(farmers.userId, input.farmerId))
    .limit(1);
  if (!farmer) throw new DomainError('farmer_profile_required');
  const wardId = input.wardId ?? farmer.wardId;
  if (wardId === null || wardId === undefined) {
    throw new DomainError('invalid_request', { fields: ['wardId'] });
  }

  const replay = async () => {
    const [existing] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.idempotencyKey, key))
      .limit(1);
    if (!existing) return null;
    if (!sameRequest(existing, input, wardId)) throw new DomainError('idempotency_key_reused');
    return { booking: existing, created: false };
  };
  const earlier = await replay();
  if (earlier) return earlier;

  const [ward] = await ctx.db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, wardId))
    .limit(1);
  if (!ward) throw new DomainError('invalid_request', { fields: ['wardId'] });
  if (input.animalId) {
    const [animal] = await ctx.db
      .select({ id: animals.id })
      .from(animals)
      .where(and(eq(animals.id, input.animalId), eq(animals.farmerId, input.farmerId)))
      .limit(1);
    if (!animal) throw new DomainError('not_found');
  }

  const now = ctx.clock();
  const [inserted] = await ctx.db
    .insert(bookings)
    .values({
      farmerId: input.farmerId,
      animalId: input.animalId ?? null,
      species: input.species,
      problemType: input.problemType,
      note: input.note ?? null,
      isEmergency: input.isEmergency,
      sourceChannel: input.channel,
      wardId,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      feeQuoted: await quoteCallOutFee(),
      idempotencyKey: key,
      createdAt: now,
    })
    // A concurrent retry with the same key: one insert wins, the other replays it.
    .onConflictDoNothing({ target: bookings.idempotencyKey })
    .returning();
  if (inserted) return { booking: inserted, created: true };
  const raced = await replay();
  if (!raced) throw new Error('idempotent insert conflicted but no booking found');
  return raced;
}

export type BookingViewer = { kind: 'farmer'; userId: string } | { kind: 'vet'; userId: string };

/** One booking as the viewer may see it. Anyone else gets "not found" (no existence leak). */
export async function viewBooking(
  ctx: AppContext,
  bookingId: number,
  viewer: BookingViewer,
): Promise<FarmerBookingView | VetJobView> {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (viewer.kind === 'farmer' && b?.farmerId === viewer.userId) {
    const [view] = await farmerViews(ctx.db, [b]);
    if (view) return view;
  }
  if (viewer.kind === 'vet' && b && b.vetId === viewer.userId) {
    const [view] = await vetJobViews(ctx.db, [b]);
    if (view) return view;
  }
  throw new DomainError('not_found');
}

export interface Page {
  limit: number;
  /** Return bookings with an id lower than this (newest first). */
  before?: number | undefined;
}

function pageConditions(page: Page, ...base: SQL[]): SQL | undefined {
  return and(...base, ...(page.before ? [lt(bookings.id, page.before)] : []));
}

export async function listFarmerBookings(
  ctx: AppContext,
  farmerId: string,
  page: Page,
): Promise<FarmerBookingView[]> {
  const rows = await ctx.db
    .select()
    .from(bookings)
    .where(pageConditions(page, eq(bookings.farmerId, farmerId)))
    .orderBy(desc(bookings.id))
    .limit(page.limit);
  return farmerViews(ctx.db, rows);
}

export async function listVetJobs(
  ctx: AppContext,
  vetId: string,
  page: Page,
): Promise<VetJobView[]> {
  const rows = await ctx.db
    .select()
    .from(bookings)
    .where(pageConditions(page, eq(bookings.vetId, vetId)))
    .orderBy(desc(bookings.id))
    .limit(page.limit);
  return vetJobViews(ctx.db, rows);
}

export async function cancelByFarmer(
  ctx: AppContext,
  bookingId: number,
  farmer: { userId: string; channel: Channel },
  reason: CancelReason,
): Promise<BookingRow> {
  const now = ctx.clock();
  return ctx.db.transaction(async (tx) => {
    const result = await transition(
      tx,
      bookingId,
      'farmer_cancelled',
      { kind: 'farmer', ...farmer },
      now,
      { reason },
    );
    // Refund or forfeit, per payments/policy.ts, in the same transaction as the cancellation.
    if (result.changed && depositOutcomeOnCancel(result.from, 'farmer_cancelled') === 'refund') {
      await createRefundIfPaid(tx, bookingId, now, 'farmer_cancelled');
    }
    return result.booking;
  });
}

/** Vet job steps: on my way, arrived. Idempotent on retry. */
export async function vetStep(
  ctx: AppContext,
  bookingId: number,
  step: 'en_route' | 'in_service',
  vet: { userId: string; channel: Channel },
): Promise<BookingRow> {
  const event = step === 'en_route' ? 'vet_en_route' : 'vet_arrived';
  const now = ctx.clock();
  const result = await ctx.db.transaction((tx) =>
    transition(tx, bookingId, event, { kind: 'vet', ...vet }, now),
  );
  return result.booking;
}

/** The assigned vet hands the job back before setting off; it goes back to searching. */
export async function releaseByVet(
  ctx: AppContext,
  bookingId: number,
  vet: { userId: string; channel: Channel },
): Promise<BookingRow> {
  const now = ctx.clock();
  const result = await ctx.db.transaction((tx) =>
    transition(tx, bookingId, 'vet_released', { kind: 'vet', ...vet }, now),
  );
  return result.booking;
}

export interface CompletionInput {
  diagnosis?: string | undefined;
  diagnosisCode?: string | undefined;
  drugsUsed?: string | undefined;
  /** Original text (form notes or the SMS body). Stored even if nothing else parses. */
  rawNotes: string;
  followUpDate?: string | undefined;
  /** When the vet completed it on the device, if logged offline. */
  clientCreatedAt?: Date | undefined;
}

/**
 * Complete a job and record the treatment, exactly once: the treatment is written in the same
 * transaction as the transition, and a retry of an already-completed job writes nothing.
 */
export async function completeByVet(
  ctx: AppContext,
  bookingId: number,
  vet: { userId: string; channel: Channel },
  input: CompletionInput,
): Promise<BookingRow> {
  const now = ctx.clock();
  return ctx.db.transaction(async (tx) => {
    const result = await transition(tx, bookingId, 'vet_completed', { kind: 'vet', ...vet }, now);
    if (result.changed) {
      await tx.insert(treatments).values({
        bookingId,
        animalId: result.booking.animalId,
        diagnosis: input.diagnosis ?? null,
        diagnosisCode: input.diagnosisCode ?? null,
        drugsUsed: input.drugsUsed ?? null,
        rawNotes: input.rawNotes,
        followUpDate: input.followUpDate ?? null,
        clientCreatedAt: input.clientCreatedAt ?? null,
        createdAt: now,
      });
    }
    return result.booking;
  });
}

/**
 * The farmer rates a completed visit once. A retry with the same stars succeeds; a different
 * rating is refused. Updates the vet's average rating in the same transaction.
 */
export async function rateBooking(
  ctx: AppContext,
  bookingId: number,
  farmerId: string,
  input: { stars: number; comment?: string | undefined },
): Promise<void> {
  const now = ctx.clock();
  await ctx.db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.farmerId, farmerId)))
      .limit(1);
    if (!b) throw new DomainError('not_found');
    if (b.status !== 'done' || !b.vetId) {
      throw new DomainError('invalid_transition', { event: 'rate', status: b.status });
    }
    const inserted = await tx
      .insert(ratings)
      .values({ bookingId, stars: input.stars, comment: input.comment ?? null, createdAt: now })
      .onConflictDoNothing({ target: ratings.bookingId })
      .returning({ id: ratings.id });
    if (inserted.length === 0) {
      const [existing] = await tx.select().from(ratings).where(eq(ratings.bookingId, bookingId));
      if (existing?.stars === input.stars) return;
      throw new DomainError('already_rated');
    }
    const [agg] = await tx
      .select({ average: avg(ratings.stars) })
      .from(ratings)
      .innerJoin(bookings, eq(bookings.id, ratings.bookingId))
      .where(eq(bookings.vetId, b.vetId));
    const average =
      agg?.average === null || agg?.average === undefined ? null : Number(agg.average);
    await tx
      .update(vets)
      .set({ rating: average === null ? null : average.toFixed(1) })
      .where(eq(vets.userId, b.vetId));
  });
}

/** Admin cancellation (support): any non-terminal booking, audit-logged by the caller. */
export async function cancelByAdmin(
  ctx: AppContext,
  bookingId: number,
  adminUserId: string,
  reason: string,
): Promise<BookingRow> {
  const now = ctx.clock();
  return ctx.db.transaction(async (tx) => {
    const result = await transition(
      tx,
      bookingId,
      'admin_cancelled',
      { kind: 'admin', userId: adminUserId },
      now,
      { reason },
    );
    if (result.changed && depositOutcomeOnCancel(result.from, 'admin_cancelled') === 'refund') {
      await createRefundIfPaid(tx, bookingId, now, 'admin_cancelled');
    }
    return result.booking;
  });
}

// ---- Offers -------------------------------------------------------------------------------

/**
 * Record an offer to a vet (used by dispatch in M8). One offer per vet per booking; returns
 * null if this vet was already offered the booking.
 */
export async function createOffer(
  ctx: AppContext,
  input: { bookingId: number; vetId: string; wave: number; channel: 'push' | 'sms' | 'both' },
): Promise<number | null> {
  const [row] = await ctx.db
    .insert(bookingOffers)
    .values({ ...input, sentAt: ctx.clock() })
    .onConflictDoNothing()
    .returning({ id: bookingOffers.id });
  return row?.id ?? null;
}

/**
 * Accept an offer. First accept wins regardless of channel (§8.5): the transition locks the
 * booking and is conditional on `pending`, so of two simultaneous accepts exactly one succeeds;
 * the other gets `offer_taken`. Approval is re-checked inside the transition (invariant 2).
 * An offer that already timed out may still be accepted while the booking is unclaimed.
 */
export async function acceptOffer(
  ctx: AppContext,
  input: { offerId: number; bookingId: number; vetId: string; channel: Channel },
): Promise<BookingRow> {
  const now = ctx.clock();
  return ctx.db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(bookingOffers)
      .where(
        and(
          eq(bookingOffers.id, input.offerId),
          eq(bookingOffers.bookingId, input.bookingId),
          eq(bookingOffers.vetId, input.vetId),
        ),
      )
      .limit(1);
    if (!offer) throw new DomainError('not_found');
    if (offer.response === 'declined') {
      throw new DomainError('invalid_transition', { event: 'vet_accepted', offer: 'declined' });
    }
    let result;
    try {
      result = await transition(
        tx,
        input.bookingId,
        'vet_accepted',
        { kind: 'vet', userId: input.vetId, channel: input.channel },
        now,
      );
    } catch (err) {
      if (err instanceof DomainError && err.code === 'invalid_transition') {
        throw new DomainError('offer_taken');
      }
      throw err;
    }
    if (result.changed) {
      await tx
        .update(bookingOffers)
        .set({ response: 'accepted', respondedAt: now })
        .where(eq(bookingOffers.id, offer.id));
    }
    return result.booking;
  });
}

/** Decline an offer. Idempotent; cannot decline an offer already accepted. */
export async function declineOffer(
  ctx: AppContext,
  input: { offerId: number; bookingId: number; vetId: string },
): Promise<void> {
  const [offer] = await ctx.db
    .select()
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.id, input.offerId),
        eq(bookingOffers.bookingId, input.bookingId),
        eq(bookingOffers.vetId, input.vetId),
      ),
    )
    .limit(1);
  if (!offer) throw new DomainError('not_found');
  if (offer.response === 'declined') return;
  if (offer.response === 'accepted') {
    throw new DomainError('invalid_transition', { event: 'decline', offer: 'accepted' });
  }
  await ctx.db
    .update(bookingOffers)
    .set({ response: 'declined', respondedAt: ctx.clock() })
    .where(eq(bookingOffers.id, offer.id));
}

/** Mark unanswered offers as timed out (the dispatch job in M8 calls this). */
export async function timeoutOffers(ctx: AppContext, offerIds: number[]): Promise<void> {
  if (offerIds.length === 0) return;
  const rows = await ctx.db
    .select({ id: bookingOffers.id, response: bookingOffers.response })
    .from(bookingOffers)
    .where(inArray(bookingOffers.id, offerIds));
  const open = rows.filter((r) => r.response === null).map((r) => r.id);
  if (open.length === 0) return;
  await ctx.db
    .update(bookingOffers)
    .set({ response: 'timeout', respondedAt: ctx.clock() })
    .where(inArray(bookingOffers.id, open));
}

export type { BookingActor };
