import { and, count, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { VetBadge } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, ratings, vets } from '../../db/schema/index.js';
import { getConfig } from '../config/service.js';

const JOB_BADGES: [number, VetBadge][] = [
  [500, 'jobs_500'],
  [100, 'jobs_100'],
  [50, 'jobs_50'],
];
const RESPONSE_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * Recompute badges (§24.8) from the record, never from anything the vet claims. Only approved
 * vets hold badges; everyone else is cleared. Run nightly and on approval.
 */
export async function updateBadges(
  ctx: AppContext,
  log?: FastifyBaseLogger,
  onlyVetIds?: readonly string[],
): Promise<number> {
  const now = ctx.clock();
  const th = await getConfig(ctx, 'badges.thresholds');
  const scope = onlyVetIds ? inArray(vets.userId, [...onlyVetIds]) : undefined;

  // Anyone not approved holds no badges.
  await ctx.db
    .update(vets)
    .set({ badges: [] })
    .where(and(ne(vets.verificationStatus, 'approved'), scope));

  const approved = await ctx.db
    .select({ id: vets.userId })
    .from(vets)
    .where(and(eq(vets.verificationStatus, 'approved'), scope));
  const ids = approved.map((v) => v.id);
  if (ids.length === 0) return 0;

  const [ratingRows, jobRows, responseRows] = await Promise.all([
    ctx.db
      .select({
        vetId: bookings.vetId,
        n: count(),
        avg: sql<string>`avg(${ratings.stars})`,
      })
      .from(ratings)
      .innerJoin(bookings, eq(bookings.id, ratings.bookingId))
      .where(inArray(bookings.vetId, ids))
      .groupBy(bookings.vetId),
    ctx.db
      .select({
        vetId: bookings.vetId,
        done: count(),
        vaccinations: sql<number>`count(*) filter (where ${bookings.problemType} = 'vaccination' or 'vaccination' = any(${bookings.services}))`,
      })
      .from(bookings)
      .where(and(inArray(bookings.vetId, ids), eq(bookings.status, 'done')))
      .groupBy(bookings.vetId),
    ctx.db
      .select({
        vetId: bookingOffers.vetId,
        n: count(),
        median: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${bookingOffers.respondedAt} - ${bookingOffers.sentAt}))`,
      })
      .from(bookingOffers)
      .where(
        and(
          inArray(bookingOffers.vetId, ids),
          isNotNull(bookingOffers.respondedAt),
          or(eq(bookingOffers.response, 'accepted'), eq(bookingOffers.response, 'declined')),
          gte(bookingOffers.sentAt, new Date(now.getTime() - RESPONSE_WINDOW_MS)),
        ),
      )
      .groupBy(bookingOffers.vetId),
  ]);
  const ratingBy = new Map(ratingRows.map((r) => [r.vetId, r]));
  const jobsBy = new Map(jobRows.map((r) => [r.vetId, r]));
  const responseBy = new Map(responseRows.map((r) => [r.vetId, r]));

  for (const id of ids) {
    const badges: VetBadge[] = ['verified'];
    const r = ratingBy.get(id);
    if (r && Number(r.n) >= th.topRatedRatings && Number(r.avg) >= th.topRatedMin) {
      badges.push('top_rated');
    }
    const resp = responseBy.get(id);
    if (
      resp &&
      Number(resp.n) >= th.fastResponderOffers &&
      Number(resp.median) <= th.fastResponderSeconds
    ) {
      badges.push('fast_responder');
    }
    const jobs = jobsBy.get(id);
    const done = Number(jobs?.done ?? 0);
    const jobBadge = JOB_BADGES.find(([n]) => done >= n);
    if (jobBadge) badges.push(jobBadge[1]);
    if (Number(jobs?.vaccinations ?? 0) >= th.vaccinations) badges.push('vaccinations_100');
    await ctx.db.update(vets).set({ badges }).where(eq(vets.userId, id));
  }
  log?.info({ vets: ids.length }, 'badges updated');
  return ids.length;
}
