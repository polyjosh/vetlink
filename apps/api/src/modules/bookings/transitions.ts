import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  BOOKING_TRANSITIONS,
  scheduledAnswerDeadline,
  transitionTarget,
  type BookingEvent,
  type BookingStatus,
  type Channel,
} from '@vetlink/shared';
import type { Db, Tx } from '../../db/client.js';
import { bookingEvents, bookingOffers, bookings, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { getConfig } from '../config/service.js';
import { vetPrice } from './pricing.js';

/**
 * THE ONLY place that writes `bookings.status` (invariant 3). Every channel (REST, USSD, SMS,
 * jobs, admin) changes a booking by calling `transition` inside its own transaction.
 */

export type BookingActor =
  | { kind: 'farmer'; userId: string; channel: Channel }
  | { kind: 'vet'; userId: string; channel: Channel }
  | { kind: 'admin'; userId: string }
  | { kind: 'system' };

export type BookingRow = typeof bookings.$inferSelect;

export interface TransitionResult {
  booking: BookingRow;
  /** False when the booking was already in the target state from the same event (a retry). */
  changed: boolean;
  from: BookingStatus;
  /** The booking_events row written (null for a retry). Identifies the change for side effects. */
  eventId: number | null;
}

export interface TransitionOptions {
  /** Shown in the event log (cancellation reason, failure cause). Never PII. */
  reason?: string;
  /** `farmer_rechose`: the vet the farmer chose this time (§24.6). */
  requestedVetId?: string;
}

/** Statuses the system moves on by itself when their deadline passes (§24.6). */
const DEADLINE_MINUTES_KEY = {
  requested: 'request',
  awaiting_deposit: 'deposit',
  vet_unavailable: 'abandon',
} as const;

function actorUserId(actor: BookingActor): string | null {
  return actor.kind === 'system' ? null : actor.userId;
}

function actorChannel(actor: BookingActor): Channel | null {
  if (actor.kind === 'farmer' || actor.kind === 'vet') return actor.channel;
  return actor.kind === 'admin' ? 'admin' : null;
}

/**
 * Apply `event` to booking `bookingId` as `actor`, atomically:
 * - the actor kind must be allowed for the event;
 * - farmers may act only on their own bookings; vets only on bookings assigned to them, except
 *   `vet_accepted`, which assigns the booking to the accepting vet (first accept wins);
 * - the UPDATE is conditional on the current status, so concurrent transitions cannot both win.
 *
 * A repeat of an event that already happened (same target state, same actor) returns
 * `changed: false` instead of failing, so offline outboxes and SMS retries are safe.
 * Throws `not_found` when the actor may not see the booking, `invalid_transition` otherwise.
 */
export async function transition(
  tx: Tx,
  bookingId: number,
  event: BookingEvent,
  actor: BookingActor,
  now: Date,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  const rule = BOOKING_TRANSITIONS[event];
  if (!rule.actors.includes(actor.kind)) throw new DomainError('invalid_transition', { event });

  // Lock the booking: concurrent transitions (two vets accepting, a farmer cancelling while the
  // vet sets off) queue here, and `current.status` is exact for the event log.
  const [current] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1)
    .for('update');
  if (!current) throw new DomainError('not_found');
  // Visibility: a farmer sees only their bookings; a vet only bookings assigned to them (any vet
  // with an offer may accept, which the offers service checks before calling us).
  if (actor.kind === 'farmer' && current.farmerId !== actor.userId) {
    throw new DomainError('not_found');
  }
  // The vet a farmer chose may turn the request down before it is theirs (§24.6).
  const vetOwns =
    event === 'vet_declined_request'
      ? current.requestedVetId === (actor.kind === 'vet' ? actor.userId : null)
      : current.vetId === (actor.kind === 'vet' ? actor.userId : null);
  if (actor.kind === 'vet' && event !== 'vet_accepted' && !vetOwns) {
    throw new DomainError('not_found');
  }
  if (event === 'vet_accepted' && actor.kind === 'vet') {
    // Checked here, not only in the offers service, so no channel (app, SMS `Y`, admin tools)
    // can assign a booking to a vet without an offer, or to an unapproved vet (invariant 2).
    const [offer] = await tx
      .select({ id: bookingOffers.id })
      .from(bookingOffers)
      .where(and(eq(bookingOffers.bookingId, bookingId), eq(bookingOffers.vetId, actor.userId)))
      .limit(1);
    if (!offer) throw new DomainError('not_found');
    const [vet] = await tx
      .select({ status: vets.verificationStatus })
      .from(vets)
      .where(eq(vets.userId, actor.userId))
      .limit(1);
    if (vet?.status !== 'approved') throw new DomainError('vet_not_approved');
  }

  const conditions: SQL[] = [eq(bookings.id, bookingId), inArray(bookings.status, rule.from)];
  if (actor.kind === 'farmer') conditions.push(eq(bookings.farmerId, actor.userId));
  if (actor.kind === 'vet' && event === 'vet_declined_request') {
    conditions.push(eq(bookings.requestedVetId, actor.userId));
  } else if (actor.kind === 'vet' && event !== 'vet_accepted') {
    conditions.push(eq(bookings.vetId, actor.userId));
  }

  const to = transitionTarget(event, current.status);
  const set: Partial<typeof bookings.$inferInsert> = { status: to };
  // Entering a waiting status starts its clock; leaving one stops it (§24.6).
  const deadlineKey = DEADLINE_MINUTES_KEY[to as keyof typeof DEADLINE_MINUTES_KEY];
  if (to === 'requested' && current.scheduledFor) {
    // A scheduled visit: the vet has up to 2 h, ending 1 h before the slot (§24.10).
    set.statusDeadlineAt = scheduledAnswerDeadline(now, current.scheduledFor);
  } else if (deadlineKey) {
    const minutes = (await getConfig({ db: tx as unknown as Db }, 'booking.chooseFlowMinutes'))[
      deadlineKey
    ];
    set.statusDeadlineAt = new Date(now.getTime() + minutes * 60_000);
  } else {
    set.statusDeadlineAt = null;
  }
  if (event === 'farmer_rechose') {
    if (!options.requestedVetId) throw new Error('farmer_rechose needs requestedVetId');
    set.requestedVetId = options.requestedVetId;
  }
  // Going to waves: the chosen vet handed a paid job back, or the farmer asked for anyone.
  if (event === 'vet_released' || event === 'farmer_switched_to_auto') set.dispatchMode = 'auto';
  if (event === 'vet_accepted' && actor.kind === 'vet') {
    set.vetId = actor.userId;
    set.acceptedAt = now;
    // The price this vet charges for this job is fixed when they accept (§24.3).
    set.vetPrice = await vetPrice(tx, actor.userId, current.services, current.bookingFeeKes);
  }
  if (event === 'vet_released') {
    set.vetId = null;
    set.acceptedAt = null;
    set.vetPrice = null;
  }
  if (event === 'vet_completed') set.completedAt = now;

  const [updated] = await tx
    .update(bookings)
    .set(set)
    .where(and(...conditions))
    .returning();

  if (!updated) {
    // Wrong state. If this exact event already put the booking where the caller wants it (by
    // the same actor), treat it as an idempotent retry.
    if (current.status === rule.to || Object.values(rule.toFrom ?? {}).includes(current.status)) {
      const [last] = await tx
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId))
        .orderBy(desc(bookingEvents.id))
        .limit(1);
      if (last?.event === event && last.actorUserId === actorUserId(actor)) {
        return { booking: current, changed: false, from: current.status, eventId: null };
      }
    }
    throw new DomainError('invalid_transition', { event, status: current.status });
  }

  const from = current.status;
  const [logged] = await tx
    .insert(bookingEvents)
    .values({
      bookingId,
      event,
      fromStatus: from,
      toStatus: to,
      actorKind: actor.kind,
      actorUserId: actorUserId(actor),
      channel: actorChannel(actor),
      reason: options.reason ?? null,
      createdAt: now,
    })
    .returning({ id: bookingEvents.id });
  return { booking: updated, changed: true, from, eventId: logged?.id ?? null };
}

/** Columns other than status that jobs may set once (reminders sent, no-show flag; §24.10). */
type OnceFlag = 'reminderEveningSentAt' | 'reminderHourSentAt' | 'overdueFlaggedAt';

/**
 * Claim a once-only flag on a booking: set it to `now` if still empty. Returns false when
 * someone already set it, so a rerun of a job never sends twice. Status is never touched here.
 */
export async function claimBookingFlag(
  db: Db | Tx,
  bookingId: number,
  flag: OnceFlag,
  now: Date,
): Promise<boolean> {
  const column = bookings[flag];
  const rows = await db
    .update(bookings)
    .set({ [flag]: now })
    .where(and(eq(bookings.id, bookingId), isNull(column)))
    .returning({ id: bookings.id });
  return rows.length > 0;
}
