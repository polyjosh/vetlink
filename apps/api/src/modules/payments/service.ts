import { and, desc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DepositState } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookings, payments, users } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import { audit } from '../admin/audit.js';
import { afterCommit } from '../bookings/effects.js';
import { transition } from '../bookings/transitions.js';
import { CANCELLED_RESULT_CODES, type StkResult } from './gateway.js';
import {
  PAYMENT_GIVE_UP_AFTER_MS,
  PAYMENT_STUCK_AFTER_MS,
  UNPAID_BOOKING_EXPIRES_AFTER_MS,
} from './policy.js';
import {
  creditLatePayment,
  creditedBookings,
  debitBookingFee,
  walletBalance,
} from '../wallet/service.js';

export type PaymentRow = typeof payments.$inferSelect;

/**
 * Start (or return the in-flight) deposit STK push for a booking. The farmer never marks a
 * payment successful and never sets the amount (invariant 4). One pending deposit per booking
 * (unique index), so double taps and retries never send two prompts.
 */
export async function requestDeposit(
  ctx: AppContext,
  input: { bookingId: number; farmerId: string },
  log: FastifyBaseLogger,
): Promise<PaymentRow> {
  const now = ctx.clock();
  const [b] = await ctx.db
    .select({ booking: bookings, phone: users.phone })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.farmerId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.farmerId, input.farmerId)))
    .limit(1);
  if (!b?.phone) throw new DomainError('not_found');

  const existing = await ctx.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, input.bookingId),
        eq(payments.type, 'deposit'),
        inArray(payments.status, ['pending', 'success', 'refunded']),
      ),
    )
    .orderBy(desc(payments.id))
    .limit(1);
  if (existing[0]) return existing[0]; // in flight, or already paid
  // Auto: pay first. Chosen: pay once the vet accepted (§24.6).
  if (b.booking.status !== 'pending_payment' && b.booking.status !== 'awaiting_deposit') {
    throw new DomainError('invalid_transition', { event: 'pay', status: b.booking.status });
  }

  const fee = b.booking.bookingFeeKes;
  // §24.25: credit pays first. Enough of it: paid at once, no M-Pesa prompt.
  const credit = Math.min(fee, await walletBalance(ctx.db, input.farmerId));
  if (credit === fee) {
    const paid = await payFromWallet(ctx, b.booking, fee, now);
    if (paid) return paid;
  }
  const walletPart = Math.min(fee, await walletBalance(ctx.db, input.farmerId));
  const [payment] = await ctx.db
    .insert(payments)
    .values({
      bookingId: input.bookingId,
      type: 'deposit',
      amount: fee,
      // Only the rest goes by STK push; the credit is taken when M-Pesa confirms.
      walletAmount: walletPart,
      status: 'pending',
      phone: b.phone,
      createdAt: now,
      updatedAt: now,
    })
    // A concurrent request created the pending deposit first: return that one.
    .onConflictDoNothing()
    .returning();
  if (!payment) {
    const [raced] = await ctx.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, input.bookingId), eq(payments.type, 'deposit')))
      .orderBy(desc(payments.id))
      .limit(1);
    if (!raced) throw new Error('deposit insert conflicted but none found');
    return raced;
  }

  try {
    const accepted = await ctx.payments.stkPush({
      phone: b.phone,
      amount: payment.amount - payment.walletAmount,
      accountReference: `VL${input.bookingId}`,
      description: 'VetLink dep',
    });
    const [updated] = await ctx.db
      .update(payments)
      .set({
        checkoutRequestId: accepted.checkoutRequestId,
        merchantRequestId: accepted.merchantRequestId,
        updatedAt: ctx.clock(),
      })
      .where(eq(payments.id, payment.id))
      .returning();
    return updated ?? payment;
  } catch (err) {
    log.error({ err, paymentId: payment.id, phone: maskPhone(b.phone) }, 'STK push failed');
    await ctx.db
      .update(payments)
      .set({ status: 'failed', resultDesc: 'stk_push_rejected', updatedAt: ctx.clock() })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));
    throw new DomainError('payment_unavailable');
  }
}

/**
 * Apply an STK outcome, exactly once. Callbacks are untrusted (§8.6): they may be late,
 * duplicated, or forged, so a callback's success is confirmed with an STK query before any
 * money is counted. A payment that is no longer pending is never changed again.
 */
export async function handleStkResult(
  ctx: AppContext,
  incoming: StkResult,
  source: 'callback' | 'query',
  log: FastifyBaseLogger,
): Promise<void> {
  const [payment] = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.checkoutRequestId, incoming.checkoutRequestId))
    .limit(1);
  if (!payment) {
    log.warn({ source }, 'STK result for an unknown checkout request');
    return;
  }
  if (payment.status !== 'pending') {
    log.info({ paymentId: payment.id, source }, 'STK result for a settled payment ignored');
    return;
  }

  let result = incoming;
  if (source === 'callback' && incoming.resultCode === 0) {
    const confirmed = await ctx.payments.query(incoming.checkoutRequestId);
    if (confirmed.state === 'processing') {
      log.warn(
        { paymentId: payment.id },
        'callback success not yet confirmed by query; will retry',
      );
      throw new Error('STK success not confirmed yet'); // job retries; reconciliation backs it up
    }
    if (confirmed.result.resultCode !== 0) {
      log.warn({ paymentId: payment.id }, 'callback said success but query disagrees');
      result = confirmed.result;
    }
  }

  const now = ctx.clock();
  if (result.resultCode !== 0) {
    await ctx.db
      .update(payments)
      .set({
        status: CANCELLED_RESULT_CODES.includes(result.resultCode) ? 'cancelled' : 'failed',
        resultCode: result.resultCode,
        resultDesc: result.resultDesc.slice(0, 200),
        updatedAt: now,
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));
    // The booking stays in pending_payment: the farmer can try again until it expires.
    return;
  }

  if (
    result.amount !== undefined &&
    Math.round(result.amount) !== payment.amount - payment.walletAmount
  ) {
    // Should never happen (we set the amount); money needs a human, not a guess.
    log.error({ paymentId: payment.id }, 'STK amount does not match the deposit');
    await ctx.db
      .update(payments)
      .set({ status: 'failed', resultDesc: 'amount_mismatch', resultCode: 0, updatedAt: now })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));
    await audit(
      ctx.db,
      {
        actorUserId: null,
        action: 'payment.amount_mismatch',
        entity: 'payment',
        entityId: String(payment.id),
        meta: { expected: payment.amount - payment.walletAmount, received: result.amount },
      },
      now,
    );
    return;
  }

  const confirmed = await ctx.db.transaction(async (tx) => {
    const [settled] = await tx
      .update(payments)
      .set({
        status: 'success',
        resultCode: 0,
        resultDesc: result.resultDesc.slice(0, 200),
        mpesaReceipt: result.receipt ?? null,
        updatedAt: now,
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
      .returning();
    if (!settled) return null; // a concurrent result got there first
    const [booking] = await tx
      .select({ status: bookings.status, farmerId: bookings.farmerId })
      .from(bookings)
      .where(eq(bookings.id, settled.bookingId));
    if (booking?.status === 'pending_payment' || booking?.status === 'awaiting_deposit') {
      if (settled.walletAmount > 0) {
        // The credit part of the fee: taken now that the M-Pesa part is in (§24.25).
        await debitBookingFee(tx, {
          userId: booking.farmerId,
          bookingId: settled.bookingId,
          amount: settled.walletAmount,
          now,
        });
      }
      return transition(tx, settled.bookingId, 'deposit_confirmed', { kind: 'system' }, now, {
        reason: source,
      });
    } else {
      // Paid after the booking was cancelled or expired: never refunded, credited (§24.25).
      await creditLatePayment(tx, ctx, settled, now);
      log.warn({ paymentId: settled.id, status: booking?.status }, 'late deposit; wallet credited');
      return null;
    }
  });
  // Paid: start looking for a vet (dispatch runs as a job once this has committed).
  if (confirmed) await afterCommit(ctx, confirmed, 'deposit_confirmed');
}

export interface ReconcileSummary {
  queried: number;
  failed: number;
  expired: number;
}

/**
 * Every minute (worker): settle payments whose callback never came, give up on ones with no
 * outcome, and expire bookings left unpaid. Safe to run concurrently or repeatedly.
 */
export async function reconcilePayments(
  ctx: AppContext,
  log: FastifyBaseLogger,
): Promise<ReconcileSummary> {
  const now = ctx.clock();
  const summary: ReconcileSummary = { queried: 0, failed: 0, expired: 0 };
  const stuck = await ctx.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.type, 'deposit'),
        eq(payments.status, 'pending'),
        lt(payments.createdAt, new Date(now.getTime() - PAYMENT_STUCK_AFTER_MS)),
      ),
    )
    .limit(100);

  for (const p of stuck) {
    const stale = p.createdAt.getTime() < now.getTime() - PAYMENT_GIVE_UP_AFTER_MS;
    if (p.checkoutRequestId) {
      try {
        const q = await ctx.payments.query(p.checkoutRequestId);
        summary.queried += 1;
        if (q.state === 'final') {
          await handleStkResult(ctx, q.result, 'query', log);
          continue;
        }
      } catch (err) {
        log.warn({ err, paymentId: p.id }, 'STK query failed; will retry');
        if (!stale) continue;
      }
    }
    // Never sent, or still nothing after the give-up window.
    if (!p.checkoutRequestId || stale) {
      const updated = await ctx.db
        .update(payments)
        .set({
          status: 'failed',
          resultDesc: p.checkoutRequestId ? 'no_result' : 'not_sent',
          updatedAt: now,
        })
        .where(and(eq(payments.id, p.id), eq(payments.status, 'pending')))
        .returning({ id: payments.id });
      summary.failed += updated.length;
    }
  }

  // Unpaid bookings with nothing in flight expire (pending_payment → expired).
  const unpaid = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'pending_payment'),
        lt(bookings.createdAt, new Date(now.getTime() - UNPAID_BOOKING_EXPIRES_AFTER_MS)),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(payments)
            .where(
              and(
                eq(payments.bookingId, bookings.id),
                inArray(payments.status, ['pending', 'success']),
              ),
            ),
        ),
      ),
    )
    .limit(100);
  for (const b of unpaid) {
    try {
      await ctx.db.transaction((tx) =>
        transition(tx, b.id, 'payment_failed', { kind: 'system' }, now, { reason: 'unpaid' }),
      );
      summary.expired += 1;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err; // paid or cancelled meanwhile: fine
    }
  }
  if (summary.queried || summary.failed || summary.expired)
    log.info(summary, 'payments reconciled');
  return summary;
}

/**
 * A finance admin records that a pending refund was sent (M-Pesa reversal or B2C done by hand).
 * Step-up and audit are enforced by the route. The deposit becomes `refunded`.
 */
export async function completeRefund(
  ctx: AppContext,
  refundId: number,
  mpesaReceipt: string,
  adminUserId: string,
): Promise<PaymentRow> {
  const now = ctx.clock();
  const refund = await ctx.db.transaction(async (tx) => {
    const [done] = await tx
      .update(payments)
      .set({ status: 'success', mpesaReceipt, updatedAt: now })
      .where(
        and(eq(payments.id, refundId), eq(payments.type, 'refund'), eq(payments.status, 'pending')),
      )
      .returning();
    if (!done?.refundOf) throw new DomainError('not_found');
    await tx
      .update(payments)
      .set({ status: 'refunded', updatedAt: now })
      .where(and(eq(payments.id, done.refundOf), eq(payments.status, 'success')));
    return done;
  });
  await audit(
    ctx.db,
    {
      actorUserId: adminUserId,
      action: 'payment.refunded',
      entity: 'payment',
      entityId: String(refundId),
      meta: { bookingId: refund.bookingId, amount: refund.amount },
    },
    now,
  );
  return refund;
}

/** Deposit state of bookings, for booking views. */
/**
 * The whole fee from the wallet: debited, recorded as a paid deposit (method `wallet`), and the
 * booking moves on, all at once. Null if the credit ran out meanwhile (then M-Pesa is used).
 */
async function payFromWallet(
  ctx: AppContext,
  booking: typeof bookings.$inferSelect,
  fee: number,
  now: Date,
): Promise<PaymentRow | null> {
  class NotEnough extends Error {}
  try {
    const { payment, result } = await ctx.db.transaction(async (tx) => {
      const taken = await debitBookingFee(tx, {
        userId: booking.farmerId,
        bookingId: booking.id,
        amount: fee,
        now,
      });
      if (taken < fee) throw new NotEnough();
      const [row] = await tx
        .insert(payments)
        .values({
          bookingId: booking.id,
          type: 'deposit',
          amount: fee,
          method: 'wallet',
          walletAmount: fee,
          status: 'success',
          resultCode: 0,
          resultDesc: 'wallet',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('wallet payment insert failed');
      const r = await transition(tx, booking.id, 'deposit_confirmed', { kind: 'system' }, now, {
        reason: 'wallet',
      });
      return { payment: row, result: r };
    });
    await afterCommit(ctx, result, 'deposit_confirmed');
    return payment;
  } catch (err) {
    if (err instanceof NotEnough) return null;
    throw err;
  }
}

export async function depositStates(
  ctx: Pick<AppContext, 'db'>,
  bookingIds: number[],
): Promise<
  Map<number, { status: DepositState; receipt: string | null; paymentId: number | null }>
> {
  const out = new Map<
    number,
    { status: DepositState; receipt: string | null; paymentId: number | null }
  >();
  if (bookingIds.length === 0) return out;
  const rows = await ctx.db
    .select()
    .from(payments)
    .where(inArray(payments.bookingId, bookingIds))
    .orderBy(payments.id);
  const credited = await creditedBookings(ctx.db, bookingIds);
  for (const id of bookingIds) {
    const mine = rows.filter((r) => r.bookingId === id);
    const deposits = mine.filter((r) => r.type === 'deposit');
    const paid = deposits.find((r) => r.status === 'success' || r.status === 'refunded');
    const refund = mine.find((r) => r.type === 'refund');
    const latest = deposits.at(-1);
    let status: DepositState = 'none';
    if (paid && credited.has(id)) status = 'credited';
    else if (paid?.status === 'refunded') status = 'refunded';
    else if (paid && refund?.status === 'pending') status = 'refund_pending';
    else if (paid) status = 'paid';
    else if (latest?.status === 'pending') status = 'pending';
    else if (latest) status = 'failed';
    out.set(id, {
      status,
      receipt: paid?.mpesaReceipt ?? null,
      paymentId: (paid ?? latest)?.id ?? null,
    });
  }
  return out;
}
