import { eq, max } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { BookingEvent } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, locations, users } from '../../db/schema/index.js';
import { requestDeposit } from '../payments/service.js';
import type { BookingRow, TransitionResult } from './transitions.js';

/**
 * Side effects of booking changes (notifications, dispatch), run as a job after the change has
 * committed, so a slow SMS gateway never slows or fails the request that made the change.
 * Keyed by the booking_events row, so each change has its effects exactly once.
 */
export async function afterCommit(
  ctx: AppContext,
  result: TransitionResult,
  event: BookingEvent,
): Promise<void> {
  if (!result.changed || result.eventId === null) return;
  await ctx.jobs.add(
    'bookings.after-transition',
    { bookingId: result.booking.id, event },
    { jobId: `after-${result.eventId}` },
  );
}

/** Ask the farmer for the booking fee once their chosen vet accepted (§24.6 step 6). */
async function askForBookingFee(ctx: AppContext, b: BookingRow, log: FastifyBaseLogger) {
  try {
    await requestDeposit(ctx, { bookingId: b.id, farmerId: b.farmerId }, log);
  } catch (err) {
    // M-Pesa is down: the farmer can press "Pay" again until the deadline.
    log.warn({ err, bookingId: b.id }, 'booking fee prompt not sent');
  }
}

export async function runBookingEffects(
  ctx: AppContext,
  input: { bookingId: number; event: BookingEvent },
  log: FastifyBaseLogger,
): Promise<void> {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, input.bookingId));
  if (!b) return;
  const vetName = async () => {
    if (!b.vetId) return { name: '', phone: '' };
    const [v] = await ctx.db
      .select({ name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.id, b.vetId));
    return { name: v?.name ?? 'VetLink', phone: v?.phone ?? '' };
  };
  const toFarmer = (
    kind:
      | 'booking_matched'
      | 'vet_en_route'
      | 'vet_arrived'
      | 'booking_completed'
      | 'no_vet_found'
      | 'booking_cancelled',
    params: Record<string, string | number>,
  ) =>
    ctx.jobs.add(
      'notifications.send',
      { userId: b.farmerId, kind, params: { ref: b.id, ...params }, data: { bookingId: b.id } },
      { jobId: `notify-${b.id}-${input.event}-farmer` },
    );

  const once = `${b.id}-${input.event}-${b.statusDeadlineAt?.getTime() ?? b.vetId ?? ''}`;
  switch (input.event) {
    case 'deposit_confirmed':
      if (b.dispatchMode === 'chosen' && b.vetId) {
        // Paid after the chosen vet accepted: matched at once; both sides get each other's details.
        const v = await vetName();
        await toFarmer('booking_matched', { vet: v.name, phone: v.phone });
        const [f] = await ctx.db
          .select({ name: users.name, displayName: users.displayName, phone: users.phone })
          .from(users)
          .where(eq(users.id, b.farmerId));
        const [w] = await ctx.db
          .select({ ward: locations.ward })
          .from(locations)
          .where(eq(locations.id, b.wardId));
        await ctx.jobs.add(
          'notifications.send',
          {
            userId: b.vetId,
            kind: 'request_confirmed',
            params: {
              ref: b.id,
              farmer: f?.displayName ?? f?.name ?? '',
              phone: f?.phone ?? '',
              ward: w?.ward ?? '',
            },
            data: { bookingId: b.id },
          },
          { jobId: `notify-${b.id}-confirmed-vet` },
        );
        return;
      }
      await ctx.jobs.add(
        'matching.dispatch',
        { bookingId: b.id, wave: 1 },
        { jobId: `dispatch-${b.id}-1` },
      );
      return;
    case 'vet_released': {
      // Back to searching: the next wave excludes everyone already offered, including this vet.
      const [row] = await ctx.db
        .select({ wave: max(bookingOffers.wave) })
        .from(bookingOffers)
        .where(eq(bookingOffers.bookingId, b.id));
      const wave = (row?.wave ?? 0) + 1;
      await ctx.jobs.add(
        'matching.dispatch',
        { bookingId: b.id, wave },
        { jobId: `dispatch-${b.id}-${wave}` },
      );
      return;
    }
    case 'vet_accepted': {
      const v = await vetName();
      if (b.status === 'awaiting_deposit') {
        // Chosen vet said yes: the M-Pesa prompt goes out now; no contact details until paid.
        await ctx.jobs.add(
          'notifications.send',
          {
            userId: b.farmerId,
            kind: 'vet_accepted_pay',
            params: { ref: b.id, vet: v.name, deposit: b.bookingFeeKes },
            data: { bookingId: b.id },
          },
          { jobId: `notify-${once}-farmer` },
        );
        await askForBookingFee(ctx, b, log);
        return;
      }
      await toFarmer('booking_matched', { vet: v.name, phone: v.phone });
      return;
    }
    case 'vet_declined_request':
    case 'request_timed_out':
      await ctx.jobs.add(
        'notifications.send',
        {
          userId: b.farmerId,
          kind: 'request_declined',
          params: { ref: b.id },
          data: { bookingId: b.id },
        },
        { jobId: `notify-${once}-farmer` },
      );
      return;
    case 'deposit_timed_out':
      if (b.vetId) {
        await ctx.jobs.add(
          'notifications.send',
          {
            userId: b.vetId,
            kind: 'request_unpaid',
            params: { ref: b.id },
            data: { bookingId: b.id },
          },
          { jobId: `notify-${once}-vet` },
        );
      }
      return;
    case 'vet_en_route':
      await toFarmer('vet_en_route', { vet: (await vetName()).name });
      return;
    case 'vet_arrived':
      await toFarmer('vet_arrived', { vet: (await vetName()).name });
      return;
    case 'vet_completed':
      await toFarmer('booking_completed', { vet: (await vetName()).name });
      return;
    case 'no_vet_found':
      await toFarmer('no_vet_found', { deposit: b.bookingFeeKes });
      return;
    case 'farmer_cancelled':
    case 'admin_cancelled':
      if (b.vetId) {
        await ctx.jobs.add(
          'notifications.send',
          {
            userId: b.vetId,
            kind: 'booking_cancelled',
            params: { ref: b.id },
            data: { bookingId: b.id },
          },
          { jobId: `notify-${b.id}-${input.event}-vet` },
        );
      }
      if (input.event === 'admin_cancelled') await toFarmer('booking_cancelled', {});
      return;
    default:
      log.debug({ event: input.event }, 'no effects');
  }
}
