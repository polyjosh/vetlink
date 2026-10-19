import { eq, max } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { BookingEvent } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, users } from '../../db/schema/index.js';
import type { TransitionResult } from './transitions.js';

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

  switch (input.event) {
    case 'deposit_confirmed':
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
      await toFarmer('booking_matched', { vet: v.name, phone: v.phone });
      return;
    }
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
