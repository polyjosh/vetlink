import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { payments } from '../../db/schema/index.js';

/**
 * Record a refund of the booking's paid deposit, if there is one and it has not been refunded.
 * Runs in the caller's transaction (the cancellation). The refund starts `pending`: a finance
 * admin sends the money back and records the M-Pesa reference (automated B2C refunds wait for
 * Open Question 21.12). Returns the refund id, or null if nothing was paid.
 */
export async function createRefundIfPaid(
  tx: Tx,
  bookingId: number,
  now: Date,
  reason: string,
): Promise<number | null> {
  const [deposit] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, bookingId),
        eq(payments.type, 'deposit'),
        inArray(payments.status, ['success']),
      ),
    )
    .limit(1);
  if (!deposit) return null;
  const [refund] = await tx
    .insert(payments)
    .values({
      bookingId,
      type: 'refund',
      amount: deposit.amount,
      status: 'pending',
      phone: deposit.phone,
      refundOf: deposit.id,
      resultDesc: reason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: payments.refundOf })
    .returning({ id: payments.id });
  return refund?.id ?? null;
}
