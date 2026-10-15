import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  BOOKING_TRANSITIONS,
  type BookingEvent,
  type BookingStatus,
  type Channel,
} from '@vetlink/shared';
import type { Tx } from '../../db/client.js';
import { bookingEvents, bookingOffers, bookings, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';

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
}

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
  if (actor.kind === 'vet' && event !== 'vet_accepted' && current.vetId !== actor.userId) {
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
  if (actor.kind === 'vet' && event !== 'vet_accepted') {
    conditions.push(eq(bookings.vetId, actor.userId));
  }

  const set: Partial<typeof bookings.$inferInsert> = { status: rule.to };
  if (event === 'vet_accepted' && actor.kind === 'vet') {
    set.vetId = actor.userId;
    set.acceptedAt = now;
  }
  if (event === 'vet_released') {
    set.vetId = null;
    set.acceptedAt = null;
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
    if (current.status === rule.to) {
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
      toStatus: rule.to,
      actorKind: actor.kind,
      actorUserId: actorUserId(actor),
      channel: actorChannel(actor),
      reason: options.reason ?? null,
      createdAt: now,
    })
    .returning({ id: bookingEvents.id });
  return { booking: updated, changed: true, from, eventId: logged?.id ?? null };
}
