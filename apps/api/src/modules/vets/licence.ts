import { and, eq, gte, lt, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../../context.js';
import { vets } from '../../db/schema/index.js';
import { suspendVet } from '../applications/review.js';

const DAY_MS = 86_400_000;
/** Warnings before a practising licence expires (§8.3: 30 and 7 days). */
const WARN_DAYS = [30, 7] as const;

/**
 * Daily: warn vets whose licence is about to expire, and suspend (offline, no offers) those whose
 * licence has expired, until a renewal is reviewed (§8.3 ongoing verification). Idempotent.
 */
export async function checkLicences(ctx: AppContext, log: FastifyBaseLogger) {
  const now = ctx.clock();
  const today = now.toISOString().slice(0, 10);
  const expired = await ctx.db
    .select({ userId: vets.userId })
    .from(vets)
    .where(and(eq(vets.verificationStatus, 'approved'), lt(vets.licenceExpiry, today)));
  for (const v of expired) {
    try {
      await suspendVet(ctx, v.userId, { reasons: ['licence_expired'] }, null);
      log.warn({ vetUserId: v.userId }, 'licence expired; vet suspended');
    } catch (err) {
      log.warn({ err, vetUserId: v.userId }, 'could not suspend vet with an expired licence');
    }
  }
  let warned = 0;
  for (const days of WARN_DAYS) {
    const day = new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);
    const due = await ctx.db
      .select({ userId: vets.userId, expiry: vets.licenceExpiry })
      .from(vets)
      .where(
        and(
          eq(vets.verificationStatus, 'approved'),
          gte(vets.licenceExpiry, today),
          lte(vets.licenceExpiry, day),
        ),
      );
    for (const v of due) {
      // Once per vet, per licence date, per threshold.
      const first = await ctx.counters.claim(
        `licence-warn:${v.userId}:${v.expiry}:${days}`,
        60 * DAY_MS,
      );
      if (!first) continue;
      await ctx.jobs.add(
        'notifications.send',
        { userId: v.userId, kind: 'licence_expiring', params: { days } },
        { jobId: `licence-${v.userId}-${v.expiry}-${days}` },
      );
      warned += 1;
    }
  }
  return { suspended: expired.length, warned };
}
