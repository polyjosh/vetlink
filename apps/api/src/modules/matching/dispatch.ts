import { and, eq, isNull, max } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { OFFER_TIMEOUT_S } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, locations } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { afterCommit } from '../bookings/effects.js';
import { createOffer, timeoutOffers } from '../bookings/service.js';
import { transition } from '../bookings/transitions.js';
import { getConfig } from '../config/service.js';
import { notify } from '../notifications/service.js';
import { createRefundIfPaid } from '../payments/refunds.js';
import { rankCandidates } from './candidates.js';
import { bookingPhotoCount } from '../media/service.js';

/**
 * Dispatch waves (§8.5): wave 1 the top 3, wave 2 the next 3, wave 3 a wider radius and the top 5;
 * an emergency goes to everyone eligible in one wave. Each wave times out (90 s, emergency 45 s)
 * or ends early once every vet in it has declined. When nobody is left the farmer is told we are
 * still searching; if still unmatched after the give-up window, the booking is cancelled
 * (`no_vet_found`) and the deposit refunded. All steps are idempotent jobs.
 */

async function pendingBooking(ctx: AppContext, bookingId: number) {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return b?.status === 'pending' ? b : null;
}

async function currentWave(ctx: AppContext, bookingId: number): Promise<number> {
  const [row] = await ctx.db
    .select({ wave: max(bookingOffers.wave) })
    .from(bookingOffers)
    .where(eq(bookingOffers.bookingId, bookingId));
  return row?.wave ?? 0;
}

export async function dispatchWave(
  ctx: AppContext,
  input: { bookingId: number; wave: number },
  log: FastifyBaseLogger,
): Promise<{ offered: number }> {
  const booking = await pendingBooking(ctx, input.bookingId);
  if (!booking) return { offered: 0 }; // accepted, cancelled or expired meanwhile
  if ((await currentWave(ctx, booking.id)) >= input.wave) return { offered: 0 }; // already sent

  const [sizes, maxRadiusKm, factor] = await Promise.all([
    getConfig(ctx, 'matching.waveSizes'),
    getConfig(ctx, 'matching.maxRadiusKm'),
    getConfig(ctx, 'matching.wideWaveRadiusFactor'),
  ]);
  const already = await ctx.db
    .select({ vetId: bookingOffers.vetId })
    .from(bookingOffers)
    .where(eq(bookingOffers.bookingId, booking.id));
  const radiusKm = !booking.isEmergency && input.wave >= 3 ? maxRadiusKm * factor : maxRadiusKm;
  const ranked = await rankCandidates(ctx, booking, {
    radiusKm,
    excludeVetIds: already.map((a) => a.vetId),
  });
  const size = sizes[Math.min(input.wave, sizes.length) - 1] ?? sizes.at(-1) ?? 3;
  const chosen = booking.isEmergency ? ranked : ranked.slice(0, size);

  if (chosen.length === 0) {
    if (!booking.isEmergency && input.wave < 3) {
      return dispatchWave(ctx, { bookingId: booking.id, wave: input.wave + 1 }, log);
    }
    await startGiveUp(ctx, booking.id, log);
    return { offered: 0 };
  }

  const [ward] = await ctx.db
    .select({ name: locations.ward })
    .from(locations)
    .where(eq(locations.id, booking.wardId));
  const photos = await bookingPhotoCount(ctx, booking.id);
  let offered = 0;
  for (const c of chosen) {
    const offerId = await createOffer(ctx, {
      bookingId: booking.id,
      vetId: c.vetId,
      wave: input.wave,
      channel: 'push',
    });
    if (offerId === null) continue;
    offered += 1;
    // Only approved vets reach here (rankCandidates), so push tokens of unapproved vets are
    // never used for offers (§8.3 gating).
    const { via } = await notify(
      ctx,
      {
        userId: c.vetId,
        kind: booking.isEmergency ? 'offerEmergency' : 'offer',
        params: {
          ref: booking.id,
          ward: ward?.name ?? '',
          km: Math.round(c.distanceKm),
          fee: booking.feeQuoted,
        },
        localized: { animal: booking.species, problem: booking.problemType, photos },
        data: { bookingId: booking.id, offerId },
        emergency: booking.isEmergency,
      },
      log,
    );
    if (via === 'sms') {
      await ctx.db
        .update(bookingOffers)
        .set({ channel: 'sms' })
        .where(eq(bookingOffers.id, offerId));
    }
  }
  const timeoutS = booking.isEmergency ? OFFER_TIMEOUT_S.emergency : OFFER_TIMEOUT_S.normal;
  await ctx.jobs.add(
    'matching.wave-timeout',
    { bookingId: booking.id, wave: input.wave },
    { jobId: `wave-timeout-${booking.id}-${input.wave}`, delayMs: timeoutS * 1000 },
  );
  log.info({ bookingId: booking.id, wave: input.wave, offered }, 'offers sent');
  return { offered };
}

/** A wave's time is up (or everyone in it declined): close it and send the next one. */
export async function waveTimedOut(
  ctx: AppContext,
  input: { bookingId: number; wave: number },
  log: FastifyBaseLogger,
): Promise<void> {
  const booking = await pendingBooking(ctx, input.bookingId);
  if (!booking) return;
  if ((await currentWave(ctx, booking.id)) !== input.wave) return; // already moved on
  const open = await ctx.db
    .select({ id: bookingOffers.id })
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.bookingId, booking.id),
        eq(bookingOffers.wave, input.wave),
        isNull(bookingOffers.response),
      ),
    );
  await timeoutOffers(
    ctx,
    open.map((o) => o.id),
  );
  if (booking.isEmergency) {
    await startGiveUp(ctx, booking.id, log);
    return;
  }
  await dispatchWave(ctx, { bookingId: booking.id, wave: input.wave + 1 }, log);
}

/** Nobody available: tell the farmer we are still searching, alert support, set a deadline. */
async function startGiveUp(ctx: AppContext, bookingId: number, log: FastifyBaseLogger) {
  const [booking] = await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) return;
  const minutes = await getConfig(ctx, 'matching.giveUpAfterMinutes');
  await ctx.jobs.add(
    'notifications.send',
    { userId: booking.farmerId, kind: 'still_searching', params: { ref: bookingId } },
    { jobId: `still-searching-${bookingId}` },
  );
  await audit(
    ctx.db,
    {
      actorUserId: null,
      action: 'booking.unmatched',
      entity: 'booking',
      entityId: String(bookingId),
    },
    ctx.clock(),
  );
  log.warn({ bookingId }, 'no vet available; support alerted'); // supply-gap alert (§8.5 step 4)
  await ctx.jobs.add(
    'matching.give-up',
    { bookingId },
    { jobId: `give-up-${bookingId}`, delayMs: minutes * 60 * 1000 },
  );
}

/** Still unmatched at the deadline: cancel (`no_vet_found`) and refund the deposit. */
export async function giveUp(ctx: AppContext, bookingId: number): Promise<void> {
  const now = ctx.clock();
  let result;
  try {
    result = await ctx.db.transaction(async (tx) => {
      const r = await transition(tx, bookingId, 'no_vet_found', { kind: 'system' }, now);
      if (r.changed) await createRefundIfPaid(tx, bookingId, now, 'no_vet_found');
      return r;
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'invalid_transition') return; // matched in time
    throw err;
  }
  await afterCommit(ctx, result, 'no_vet_found');
}
