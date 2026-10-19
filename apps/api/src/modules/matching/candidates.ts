import { and, count, eq, gte, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { ACTIVE_JOB_STATUSES, type Species, type VetService } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, locations, users, vets } from '../../db/schema/index.js';
import { distanceKm } from '../../lib/geo.js';
import { getConfig } from '../config/service.js';

/** Live location older than this falls back to the vet's base ward (§8.5). */
export const LIVE_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;
const ACCEPTANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Species a vet can take when they list one of its group (USSD books "Goat/Sheep" as goat). */
const SPECIES_GROUPS: Record<Species, readonly Species[]> = {
  cattle: ['cattle'],
  goat: ['goat', 'sheep'],
  sheep: ['sheep', 'goat'],
  pig: ['pig'],
  poultry: ['poultry'],
  dog: ['dog'],
  other: ['other'],
};

export interface Candidate {
  vetId: string;
  distanceKm: number;
  score: number;
  baseCallOutFee: number | null;
  /** Where the vet was taken to be: live location or base ward. */
  positionSource: 'live' | 'ward';
}

export interface BookingTarget {
  id?: number;
  species: Species;
  wardId: number;
  lat: number | null;
  lng: number | null;
  /** Services added to the consultation (§24.3): the vet must offer every one. */
  services?: readonly VetService[];
}

/** The farm: pinned coordinates (app/web) or the ward centroid (USSD). */
export async function bookingPosition(
  ctx: Pick<AppContext, 'db'>,
  target: BookingTarget,
): Promise<{ lat: number; lng: number } | null> {
  if (target.lat !== null && target.lng !== null) return { lat: target.lat, lng: target.lng };
  const [ward] = await ctx.db
    .select({ lat: locations.lat, lng: locations.lng })
    .from(locations)
    .where(eq(locations.id, target.wardId));
  return ward?.lat != null && ward.lng != null ? { lat: ward.lat, lng: ward.lng } : null;
}

/**
 * Vets who may be offered this job, best first (§8.5). Hard rules: approved (invariant 2), online,
 * does call-outs with a consultation fee set, offers every added service (§24.3), treats the species, within both their own service radius and `radiusKm`, under the active-job
 * limit, and not already offered this booking. Then scored with the configured weights.
 */
export async function rankCandidates(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  target: BookingTarget,
  options: { radiusKm: number; excludeVetIds?: readonly string[] },
): Promise<Candidate[]> {
  const now = ctx.clock();
  const farm = await bookingPosition(ctx, target);
  if (!farm) return [];
  const [weights, maxActiveJobs] = await Promise.all([
    getConfig(ctx, 'matching.weights'),
    getConfig(ctx, 'matching.maxActiveJobs'),
  ]);

  const rows = await ctx.db
    .select({
      vet: vets,
      wardLat: locations.lat,
      wardLng: locations.lng,
    })
    .from(vets)
    .innerJoin(users, eq(users.id, vets.userId))
    .leftJoin(locations, eq(locations.id, vets.wardId))
    .where(
      and(
        eq(vets.verificationStatus, 'approved'), // invariant 2: nobody else, ever
        eq(vets.isAvailable, true),
        eq(vets.offersCallOuts, true),
        isNotNull(vets.consultationFee),
        isNull(users.deletedAt),
        ...(target.services?.length ? [sql`${vets.services} @> ${sqlArray(target.services)}`] : []),
        sql`${vets.specialties} && ${sqlArray(SPECIES_GROUPS[target.species])}`,
      ),
    );

  const exclude = new Set(options.excludeVetIds ?? []);
  const placed = rows
    .filter((r) => !exclude.has(r.vet.userId))
    .map((r) => {
      const liveFresh =
        r.vet.shareLiveLocation &&
        r.vet.liveLat !== null &&
        r.vet.liveLng !== null &&
        r.vet.liveLocationAt !== null &&
        now.getTime() - r.vet.liveLocationAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS;
      const position = liveFresh
        ? { lat: r.vet.liveLat as number, lng: r.vet.liveLng as number }
        : r.wardLat !== null && r.wardLng !== null
          ? { lat: r.wardLat, lng: r.wardLng }
          : null;
      return { r, position, source: (liveFresh ? 'live' : 'ward') as 'live' | 'ward' };
    })
    .filter((p): p is typeof p & { position: { lat: number; lng: number } } => p.position !== null)
    .map((p) => ({ ...p, km: distanceKm(farm, p.position) }))
    .filter((p) => p.km <= Math.min(options.radiusKm, p.r.vet.serviceRadiusKm));
  if (placed.length === 0) return [];
  const ids = placed.map((p) => p.r.vet.userId);

  const [busy, offerStats, lastOffers] = await Promise.all([
    ctx.db
      .select({ vetId: bookings.vetId, n: count() })
      .from(bookings)
      .where(and(inArray(bookings.vetId, ids), inArray(bookings.status, ACTIVE_JOB_STATUSES)))
      .groupBy(bookings.vetId),
    ctx.db
      .select({
        vetId: bookingOffers.vetId,
        responded: count(bookingOffers.response),
        accepted: sql<number>`count(*) filter (where ${bookingOffers.response} = 'accepted')`,
      })
      .from(bookingOffers)
      .where(
        and(
          inArray(bookingOffers.vetId, ids),
          gte(bookingOffers.sentAt, new Date(now.getTime() - ACCEPTANCE_WINDOW_MS)),
        ),
      )
      .groupBy(bookingOffers.vetId),
    ctx.db
      .select({ vetId: bookingOffers.vetId, last: max(bookingOffers.sentAt) })
      .from(bookingOffers)
      .where(inArray(bookingOffers.vetId, ids))
      .groupBy(bookingOffers.vetId),
  ]);
  const busyBy = new Map(busy.map((b) => [b.vetId, Number(b.n)]));
  const statsBy = new Map(offerStats.map((s) => [s.vetId, s]));
  const lastBy = new Map(lastOffers.map((l) => [l.vetId, l.last]));

  return placed
    .filter((p) => (busyBy.get(p.r.vet.userId) ?? 0) < maxActiveJobs)
    .map((p) => {
      const v = p.r.vet;
      const proximity = 1 - p.km / Math.max(options.radiusKm, 0.001);
      const specialty = v.specialties.includes(target.species) ? 1 : 0.5;
      const stats = statsBy.get(v.userId);
      const responded = Number(stats?.responded ?? 0);
      // No history yet: a neutral 0.5, so new vets are neither punished nor favoured.
      const acceptance = responded > 0 ? Number(stats?.accepted ?? 0) / responded : 0.5;
      const rating = v.rating === null ? 0.6 : (Number(v.rating) - 1) / 4;
      const last = lastBy.get(v.userId);
      // Spread work: a vet offered nothing for a day scores full fairness.
      const fairness = last
        ? Math.min(1, (now.getTime() - last.getTime()) / (24 * 3600 * 1000))
        : 1;
      const score =
        weights.proximity * proximity +
        weights.specialty * specialty +
        weights.acceptance * acceptance +
        weights.rating * rating +
        weights.fairness * fairness;
      return {
        vetId: v.userId,
        distanceKm: Math.round(p.km * 10) / 10,
        score: Math.round(score * 1000) / 1000,
        baseCallOutFee: v.baseCallOutFee,
        positionSource: p.source,
      };
    })
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
}

function sqlArray(values: readonly string[]) {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}
