import { inArray } from 'drizzle-orm';
import {
  priceBreakdown,
  type PriceBreakdown,
  type PriceRange,
  type Species,
  type VetService,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Db, Tx } from '../../db/client.js';
import { vetServiceFees, vets } from '../../db/schema/index.js';
import { getConfig } from '../config/service.js';
import { rankCandidates } from '../matching/candidates.js';

/** Used when no nearby vet has a fee on file (or nobody is online). */
export const DEFAULT_CALL_OUT_FEE_KES = 500;
/** The quote is the median base fee of this many best candidates. */
const QUOTE_FROM_TOP = 3;

interface QuoteTarget {
  wardId: number;
  species: Species;
  lat?: number | null;
  lng?: number | null;
  services?: readonly VetService[];
}

const asTarget = (input: QuoteTarget) => ({
  species: input.species,
  wardId: input.wardId,
  lat: input.lat ?? null,
  lng: input.lng ?? null,
  services: input.services ?? [],
});

/**
 * The call-out fee shown before the farmer confirms (§8.6: fees are transparent before
 * commitment). Always computed on the server: the median base fee of the vets who would be
 * offered the job first. Distance bands are Open Question 21.7.
 */
export async function quoteCallOutFee(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  input: QuoteTarget,
): Promise<number> {
  const radiusKm = await getConfig(ctx, 'matching.maxRadiusKm');
  const top = (await rankCandidates(ctx, asTarget(input), { radiusKm }))
    .slice(0, QUOTE_FROM_TOP)
    .map((c) => c.baseCallOutFee)
    .filter((f): f is number => f !== null)
    .sort((a, b) => a - b);
  if (top.length === 0) return DEFAULT_CALL_OUT_FEE_KES;
  const mid = Math.floor(top.length / 2);
  return top.length % 2
    ? (top[mid] as number)
    : Math.round(((top[mid - 1] as number) + (top[mid] as number)) / 2);
}

/** Vets' prices: consultation, call-out and each service's "from" price. */
async function priceLists(db: Db | Tx, vetIds: readonly string[]) {
  if (vetIds.length === 0) return new Map();
  const [rows, fees] = await Promise.all([
    db
      .select({
        userId: vets.userId,
        consultation: vets.consultationFee,
        callOut: vets.baseCallOutFee,
      })
      .from(vets)
      .where(inArray(vets.userId, [...vetIds])),
    db
      .select()
      .from(vetServiceFees)
      .where(inArray(vetServiceFees.vetId, [...vetIds])),
  ]);
  const out = new Map<
    string,
    { consultation: number | null; callOut: number; fees: Partial<Record<VetService, number>> }
  >();
  for (const r of rows) out.set(r.userId, { ...r, callOut: r.callOut ?? 0, fees: {} });
  for (const f of fees) {
    const entry = out.get(f.vetId);
    if (entry) entry.fees[f.service] = f.feeFromKes;
  }
  return out;
}

/**
 * One vet's price for these services (§24.3): consultation + each service + call-out. Null when
 * the vet has no consultation fee or does not price a requested service.
 */
export async function vetPrice(
  db: Db | Tx,
  vetId: string,
  services: readonly VetService[],
  bookingFee: number,
): Promise<PriceBreakdown | null> {
  return (await vetPrices(db, [vetId], services, bookingFee)).get(vetId) ?? null;
}

export async function vetPrices(
  db: Db | Tx,
  vetIds: readonly string[],
  services: readonly VetService[],
  bookingFee: number,
): Promise<Map<string, PriceBreakdown>> {
  const lists = await priceLists(db, vetIds);
  const out = new Map<string, PriceBreakdown>();
  for (const [id, list] of lists) {
    if (list.consultation === null) continue;
    if (services.some((s) => list.fees[s] === undefined)) continue;
    out.set(
      id,
      priceBreakdown({
        consultation: list.consultation,
        serviceFees: list.fees,
        services,
        callOut: list.callOut,
        bookingFee,
      }),
    );
  }
  return out;
}

/**
 * Before a vet is chosen (§24.3): the spread of totals across every vet who could be offered the
 * job. Null when nobody is near; the farmer then sees the price when a vet accepts.
 */
export async function quotePriceRange(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  input: QuoteTarget,
  bookingFee: number,
): Promise<PriceRange | null> {
  const radiusKm = await getConfig(ctx, 'matching.maxRadiusKm');
  const candidates = await rankCandidates(ctx, asTarget(input), { radiusKm });
  const prices = await vetPrices(
    ctx.db,
    candidates.map((c) => c.vetId),
    input.services ?? [],
    bookingFee,
  );
  const totals = [...prices.values()].map((p) => p.total);
  if (totals.length === 0) return null;
  return {
    min: Math.min(...totals),
    max: Math.max(...totals),
    bookingFee,
    vets: totals.length,
  };
}

/** VetLink's booking fee for a new booking (admin-set; each booking keeps its own amount). */
export function currentBookingFee(ctx: Pick<AppContext, 'db'>): Promise<number> {
  return getConfig(ctx, 'payments.bookingFeeKes');
}
