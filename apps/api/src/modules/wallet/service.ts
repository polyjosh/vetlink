import { and, desc, eq, gt, inArray, max, sql, sum } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { WALLET_EXPIRY_DAYS, type WalletEntryKind } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Db, Tx } from '../../db/client.js';
import { bookings, payments, users, walletEntries } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';

/**
 * The farmer's VetLink wallet (§24.25). No money is ever refunded to M-Pesa: every refund case
 * credits the booking fee here, and the next booking fee is paid from it first. Closed: credit
 * only pays VetLink booking fees. An append-only ledger; the balance is its sum.
 */

type DbOrTx = Db | Tx;

export async function walletBalance(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(walletEntries.amount) })
    .from(walletEntries)
    .where(eq(walletEntries.userId, userId));
  return Number(row?.total ?? 0);
}

/** Lock the user's row so concurrent debits cannot spend the same credit twice. */
async function lockWallet(tx: Tx, userId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
}

/**
 * Credit a cancelled booking's paid fee to the farmer's wallet, once (replaces refunds). The
 * whole fee is credited, however it was paid (M-Pesa, wallet, or both). Returns the amount, or
 * null if nothing was paid or it was already credited. Runs in the caller's transaction.
 */
export async function creditBookingFee(
  tx: Tx,
  ctx: Pick<AppContext, 'jobs'>,
  bookingId: number,
  now: Date,
  kind: Extract<WalletEntryKind, 'credit_no_vet' | 'credit_cancelled'>,
): Promise<number | null> {
  const [paid] = await tx
    .select({ amount: payments.amount, farmerId: bookings.farmerId })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        eq(payments.bookingId, bookingId),
        eq(payments.type, 'deposit'),
        eq(payments.status, 'success'),
      ),
    )
    .limit(1);
  if (!paid) return null;
  return addCredit(tx, ctx, { userId: paid.farmerId, amount: paid.amount, kind, bookingId, now });
}

/** A payment that arrived after its booking closed: what M-Pesa took goes to the wallet. */
export async function creditLatePayment(
  tx: Tx,
  ctx: Pick<AppContext, 'jobs'>,
  payment: { bookingId: number; amount: number; walletAmount: number },
  now: Date,
): Promise<number | null> {
  const [b] = await tx
    .select({ farmerId: bookings.farmerId })
    .from(bookings)
    .where(eq(bookings.id, payment.bookingId));
  const received = payment.amount - payment.walletAmount;
  if (!b || received <= 0) return null;
  return addCredit(tx, ctx, {
    userId: b.farmerId,
    amount: received,
    kind: 'credit_late_payment',
    bookingId: payment.bookingId,
    now,
  });
}

async function addCredit(
  tx: Tx,
  ctx: Pick<AppContext, 'jobs'>,
  input: { userId: string; amount: number; kind: WalletEntryKind; bookingId: number; now: Date },
): Promise<number | null> {
  const [row] = await tx
    .insert(walletEntries)
    .values({
      userId: input.userId,
      amount: input.amount,
      kind: input.kind,
      bookingId: input.bookingId,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: walletEntries.id });
  if (!row) return null; // already credited (a retried cancellation or callback)
  await ctx.jobs.add(
    'notifications.send',
    {
      userId: input.userId,
      kind: 'wallet_credited',
      params: { amount: input.amount, ref: input.bookingId },
      data: { bookingId: input.bookingId },
    },
    { jobId: `wallet-credit-${row.id}` },
  );
  return input.amount;
}

/**
 * Pay up to `amount` of a booking fee from the wallet, once per booking. Returns what was
 * taken (0 when the wallet is empty or this booking was already debited).
 */
export async function debitBookingFee(
  tx: Tx,
  input: { userId: string; bookingId: number; amount: number; now: Date },
): Promise<number> {
  await lockWallet(tx, input.userId);
  const [already] = await tx
    .select({ amount: walletEntries.amount })
    .from(walletEntries)
    .where(
      and(
        eq(walletEntries.bookingId, input.bookingId),
        eq(walletEntries.kind, 'debit_booking_fee'),
      ),
    );
  if (already) return -already.amount;
  const take = Math.min(input.amount, await walletBalance(tx, input.userId));
  if (take <= 0) return 0;
  await tx.insert(walletEntries).values({
    userId: input.userId,
    amount: -take,
    kind: 'debit_booking_fee',
    bookingId: input.bookingId,
    createdAt: input.now,
  });
  return take;
}

/** Bookings whose fee went to the wallet (their deposit shows as `credited`). */
export async function creditedBookings(db: DbOrTx, bookingIds: number[]): Promise<Set<number>> {
  if (bookingIds.length === 0) return new Set();
  const rows = await db
    .select({ bookingId: walletEntries.bookingId })
    .from(walletEntries)
    .where(
      and(
        inArray(walletEntries.bookingId, bookingIds),
        inArray(walletEntries.kind, ['credit_no_vet', 'credit_cancelled', 'credit_late_payment']),
      ),
    );
  return new Set(rows.map((r) => r.bookingId).filter((b): b is number => b !== null));
}

export async function walletView(db: DbOrTx, userId: string, limit = 50) {
  const entries = await db
    .select()
    .from(walletEntries)
    .where(eq(walletEntries.userId, userId))
    .orderBy(desc(walletEntries.id))
    .limit(limit);
  return {
    balance: await walletBalance(db, userId),
    entries: entries.map((e) => ({
      id: e.id,
      amount: e.amount,
      kind: e.kind,
      bookingId: e.bookingId,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** A finance admin's correction (route enforces step-up and audit). Never below zero. */
export async function adjustWallet(
  ctx: AppContext,
  input: { userId: string; amount: number; note: string; adminUserId: string },
): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    await lockWallet(tx, input.userId);
    const balance = await walletBalance(tx, input.userId);
    if (balance + input.amount < 0) {
      throw new DomainError('invalid_request', { fields: ['amount'], balance });
    }
    await tx.insert(walletEntries).values({
      userId: input.userId,
      amount: input.amount,
      kind: 'adjustment',
      note: input.note,
      createdBy: input.adminUserId,
      createdAt: ctx.clock(),
    });
    return balance + input.amount;
  });
}

/**
 * Daily: credit unused for 12 months expires (§24.25). "Unused" means no wallet entry at all
 * in that time; the whole remaining balance expires in one entry.
 */
export async function expireCredit(ctx: AppContext, log: FastifyBaseLogger): Promise<number> {
  const cutoff = new Date(ctx.clock().getTime() - WALLET_EXPIRY_DAYS * 24 * 3600 * 1000);
  const stale = await ctx.db
    .select({ userId: walletEntries.userId, balance: sum(walletEntries.amount) })
    .from(walletEntries)
    .groupBy(walletEntries.userId)
    .having(
      and(
        sql`max(${walletEntries.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
        gt(sum(walletEntries.amount), sql`0`),
      ),
    );
  let expired = 0;
  for (const s of stale) {
    await ctx.db.transaction(async (tx) => {
      await lockWallet(tx, s.userId);
      const [last] = await tx
        .select({ at: max(walletEntries.createdAt) })
        .from(walletEntries)
        .where(eq(walletEntries.userId, s.userId));
      const balance = await walletBalance(tx, s.userId);
      if (balance <= 0 || !last?.at || last.at >= cutoff) return; // used meanwhile
      await tx.insert(walletEntries).values({
        userId: s.userId,
        amount: -balance,
        kind: 'expired',
        createdAt: ctx.clock(),
      });
      expired += 1;
    });
  }
  if (expired) log.info({ expired }, 'wallet credit expired');
  return expired;
}
