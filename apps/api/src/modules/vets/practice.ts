import { eq } from 'drizzle-orm';
import type { PRICED_ITEMS } from '@vetlink/shared';
import { VET_SERVICES, WEEKDAYS, type VetService, type WorkingHours } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { vetServiceFees, vets } from '../../db/schema/index.js';
import { getConfig } from '../config/service.js';

/**
 * A vet's practice and prices (§24.3, §24.10): consultation fee, a "from" price per service,
 * call-outs and premises, working hours. Asked in wizard step 5 and editable after approval
 * without review (non-critical). Prices are checked against the admin bands on the server.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const workingHoursSchema = z
  .partialRecord(
    z.enum(WEEKDAYS),
    z
      .array(z.object({ from: hhmm, to: hhmm }).refine((r) => r.from < r.to, 'from before to'))
      .max(2),
  )
  .refine(
    (h) =>
      Object.values(h).every((ranges) =>
        (ranges ?? []).every((r, i, all) => i === 0 || (all[i - 1]?.to ?? '') <= r.from),
      ),
    'ranges must not overlap',
  ) satisfies z.ZodType<WorkingHours>;

/** Fields shared by wizard step 5 and the approved vet's practice edits. */
export const practiceFields = {
  consultationFee: z.number().int().min(0),
  serviceFees: z.partialRecord(z.enum(VET_SERVICES), z.number().int().min(0)),
  offersCallOuts: z.boolean(),
  hasPremises: z.boolean(),
  premisesWardId: z.number().int().positive().nullable(),
  premisesDirections: z.string().trim().max(200).nullable(),
  premisesHours: z.string().trim().max(100).nullable(),
  workingHours: workingHoursSchema,
};

export interface PracticeState {
  services: readonly VetService[];
  consultationFee: number | null | undefined;
  serviceFees: Partial<Record<VetService, number>> | undefined;
  offersCallOuts: boolean | undefined;
  hasPremises: boolean | undefined;
  premisesWardId: number | null | undefined;
  baseCallOutFee: number | null | undefined;
}

/**
 * Problems with prices and practice, as field names (`consultationFee`, `serviceFees.vaccination`,
 * ...). `complete` also asks for everything a vet needs before going online.
 */
export async function practiceProblems(
  ctx: Pick<AppContext, 'db'>,
  p: PracticeState,
  options: { complete: boolean },
): Promise<string[]> {
  const [bands, bookingFee] = await Promise.all([
    getConfig(ctx, 'fees.serviceBands'),
    getConfig(ctx, 'payments.bookingFeeKes'),
  ]);
  const out: string[] = [];
  const outside = (item: (typeof PRICED_ITEMS)[number], fee: number) =>
    fee < bands[item].min || fee > bands[item].max;
  if (typeof p.consultationFee === 'number') {
    // The booking fee counts towards the bill, so the vet's share must never go negative.
    if (outside('consultation', p.consultationFee) || p.consultationFee < bookingFee) {
      out.push('consultationFee');
    }
  } else if (options.complete) out.push('consultationFee');
  for (const [service, fee] of Object.entries(p.serviceFees ?? {})) {
    if (typeof fee === 'number' && outside(service as VetService, fee)) {
      out.push(`serviceFees.${service}`);
    }
  }
  if (options.complete) {
    for (const s of p.services) {
      if (p.serviceFees?.[s] === undefined) out.push(`serviceFees.${s}`);
    }
    if (p.offersCallOuts === undefined) out.push('offersCallOuts');
    if (p.hasPremises === undefined) out.push('hasPremises');
    if (p.offersCallOuts === false && p.hasPremises === false) out.push('offersCallOuts');
    if (p.hasPremises && !p.premisesWardId) out.push('premisesWardId');
    if (p.offersCallOuts !== false && typeof p.baseCallOutFee !== 'number') {
      out.push('baseCallOutFee');
    }
  }
  return [...new Set(out)];
}

/** Write prices for the services offered (others are dropped: they cannot be booked). */
export async function writeServiceFees(
  tx: Tx,
  vetId: string,
  services: readonly VetService[],
  fees: Partial<Record<VetService, number>>,
): Promise<void> {
  await tx.delete(vetServiceFees).where(eq(vetServiceFees.vetId, vetId));
  const rows = services
    .filter((s) => typeof fees[s] === 'number')
    .map((s) => ({ vetId, service: s, feeFromKes: fees[s] as number }));
  if (rows.length) await tx.insert(vetServiceFees).values(rows);
}

/** A vet's current prices and practice, for their profile and for validation. */
export async function loadPractice(ctx: Pick<AppContext, 'db'>, vetId: string) {
  const [vet] = await ctx.db.select().from(vets).where(eq(vets.userId, vetId));
  if (!vet) return null;
  const fees = await ctx.db.select().from(vetServiceFees).where(eq(vetServiceFees.vetId, vetId));
  const serviceFees: Partial<Record<VetService, number>> = {};
  for (const f of fees) serviceFees[f.service] = f.feeFromKes;
  return { vet, serviceFees };
}
