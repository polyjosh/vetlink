import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { eatDateOf, slotWindow } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { bookings, locations } from '../../db/schema/index.js';
import { claimBookingFlag, type BookingRow } from './transitions.js';

/**
 * Scheduled visits (§24.10): reminders to both sides the evening before (18:00 job) and an hour
 * before the slot (minute job), and a no-show flag when the vet has not set off an hour after
 * the slot started. Each is claimed first, so it goes out once.
 */

const HOUR = 3600 * 1000;

async function wardName(ctx: AppContext, b: BookingRow) {
  const [w] = await ctx.db
    .select({ ward: locations.ward })
    .from(locations)
    .where(eq(locations.id, b.wardId));
  return w?.ward ?? '';
}

async function tellBoth(
  ctx: AppContext,
  b: BookingRow,
  kind: 'appointment_tomorrow' | 'appointment_soon',
) {
  const params = { ref: b.id, part: b.scheduledPart ?? '', ward: await wardName(ctx, b) };
  for (const userId of [b.farmerId, b.vetId]) {
    if (!userId) continue;
    await ctx.jobs.add(
      'notifications.send',
      {
        userId,
        kind,
        params,
        ...(b.scheduledPart && { localized: { part: b.scheduledPart } }),
        data: { bookingId: b.id },
      },
      { jobId: `${kind}-${b.id}-${userId}` },
    );
  }
}

/** 18:00 Nairobi: visits booked for tomorrow. */
export async function eveningAppointmentReminders(ctx: AppContext, log: FastifyBaseLogger) {
  const now = ctx.clock();
  const tomorrow = eatDateOf(new Date(now.getTime() + 24 * HOUR));
  const from = new Date(slotWindow(tomorrow, 'morning').start.getTime() - 8 * HOUR);
  const to = new Date(from.getTime() + 24 * HOUR);
  const due = await ctx.db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'matched'),
        gte(bookings.scheduledFor, from),
        lte(bookings.scheduledFor, to),
        isNull(bookings.reminderEveningSentAt),
      ),
    );
  let sent = 0;
  for (const b of due) {
    if (!(await claimBookingFlag(ctx.db, b.id, 'reminderEveningSentAt', now))) continue;
    await tellBoth(ctx, b, 'appointment_tomorrow');
    sent += 1;
  }
  if (sent) log.info({ sent }, 'appointment reminders (evening)');
  return sent;
}

/** Every minute: an hour before the slot, and the no-show check an hour after it started. */
export async function appointmentSweep(ctx: AppContext, log: FastifyBaseLogger) {
  const now = ctx.clock();
  const soon = await ctx.db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, 'matched'),
        isNotNull(bookings.scheduledFor),
        lte(bookings.scheduledFor, new Date(now.getTime() + HOUR)),
        gte(bookings.scheduledFor, now),
        isNull(bookings.reminderHourSentAt),
      ),
    );
  for (const b of soon) {
    if (await claimBookingFlag(ctx.db, b.id, 'reminderHourSentAt', now)) {
      await tellBoth(ctx, b, 'appointment_soon');
    }
  }
  // The vet has not set off an hour into the slot: flag it for admins, nudge the vet, and offer
  // the farmer a one-tap cancel (the fee becomes credit, §24.25). Never cancelled automatically.
  const late = await ctx.db
    .select()
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ['matched']),
        isNotNull(bookings.scheduledFor),
        lte(bookings.scheduledFor, new Date(now.getTime() - HOUR)),
        isNull(bookings.overdueFlaggedAt),
      ),
    );
  for (const b of late) {
    if (!(await claimBookingFlag(ctx.db, b.id, 'overdueFlaggedAt', now))) continue;
    if (b.vetId) {
      await ctx.jobs.add(
        'notifications.send',
        {
          userId: b.vetId,
          kind: 'appointment_overdue',
          params: { ref: b.id },
          data: { bookingId: b.id },
        },
        { jobId: `appointment_overdue-${b.id}` },
      );
    }
    await ctx.jobs.add(
      'notifications.send',
      {
        userId: b.farmerId,
        kind: 'appointment_late',
        params: { ref: b.id },
        data: { bookingId: b.id },
      },
      { jobId: `appointment_late-${b.id}` },
    );
    log.warn({ bookingId: b.id }, 'scheduled visit overdue');
  }
  return { reminded: soon.length, overdue: late.length };
}
