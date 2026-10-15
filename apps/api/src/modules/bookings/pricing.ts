import type { Species } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { getConfig } from '../config/service.js';
import { rankCandidates } from '../matching/candidates.js';

/** Used when no nearby vet has a fee on file (or nobody is online). */
export const DEFAULT_CALL_OUT_FEE_KES = 500;
/** The quote is the median base fee of this many best candidates. */
const QUOTE_FROM_TOP = 3;

/**
 * The call-out fee shown before the farmer confirms (§8.6: fees are transparent before
 * commitment). Always computed on the server: the median base fee of the vets who would be
 * offered the job first. Distance bands are Open Question 21.7.
 */
export async function quoteCallOutFee(
  ctx: Pick<AppContext, 'db' | 'clock'>,
  input: { wardId: number; species: Species; lat?: number | null; lng?: number | null },
): Promise<number> {
  const radiusKm = await getConfig(ctx, 'matching.maxRadiusKm');
  const top = (
    await rankCandidates(
      ctx,
      {
        species: input.species,
        wardId: input.wardId,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      },
      { radiusKm },
    )
  )
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
