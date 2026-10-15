import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';

/**
 * Set a vet online or offline. Only an approved vet can go online (invariant 2; the database
 * CHECK backs this up). Going offline is always allowed.
 */
export async function setAvailability(ctx: AppContext, userId: string, isAvailable: boolean) {
  if (!isAvailable) {
    await ctx.db.update(vets).set({ isAvailable: false }).where(eq(vets.userId, userId));
    return;
  }
  // Conditional on approval in the same statement, so a suspension cannot slip in between.
  const updated = await ctx.db
    .update(vets)
    .set({ isAvailable: true })
    .where(and(eq(vets.userId, userId), eq(vets.verificationStatus, 'approved')))
    .returning({ userId: vets.userId });
  if (updated.length > 0) return;
  const [exists] = await ctx.db
    .select({ id: vets.userId })
    .from(vets)
    .where(eq(vets.userId, userId));
  throw new DomainError(exists ? 'vet_not_approved' : 'not_found');
}
