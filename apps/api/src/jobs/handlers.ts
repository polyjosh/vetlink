import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { runBookingEffects } from '../modules/bookings/effects.js';
import { dispatchWave, giveUp, waveTimedOut } from '../modules/matching/dispatch.js';
import { deliver, notify, smsFallback } from '../modules/notifications/service.js';
import { handleStkResult, reconcilePayments } from '../modules/payments/service.js';
import { morningReminders, sendVetFollowUpAlerts } from '../modules/reminders/service.js';
import { updateBadges } from '../modules/vets/badges.js';
import { checkLicences } from '../modules/vets/licence.js';
import type { JobName, JobPayloads } from './types.js';

type Handler<N extends JobName> = (
  ctx: AppContext,
  data: JobPayloads[N],
  log: FastifyBaseLogger,
) => Promise<unknown>;

/** What each job does. The worker (BullMQ) and the inline test runner both dispatch here. */
export const jobHandlers: { [N in JobName]: Handler<N> } = {
  'payments.stk-result': (ctx, data, log) => handleStkResult(ctx, data, 'callback', log),
  'payments.reconcile': (ctx, _data, log) => reconcilePayments(ctx, log),
  'bookings.after-transition': (ctx, data, log) => runBookingEffects(ctx, data, log),
  'matching.dispatch': (ctx, data, log) => dispatchWave(ctx, data, log),
  'matching.wave-timeout': (ctx, data, log) => waveTimedOut(ctx, data, log),
  'matching.give-up': (ctx, data) => giveUp(ctx, data.bookingId),
  'notifications.send': (ctx, data, log) => notify(ctx, data, log),
  'notifications.deliver': (ctx, data, log) => deliver(ctx, data.notificationId, log),
  'notifications.sms-fallback': (ctx, data, log) => smsFallback(ctx, data.notificationId, log),
  'vets.licence-check': (ctx, _data, log) => checkLicences(ctx, log),
  'reminders.morning': (ctx, _data, log) => morningReminders(ctx, log),
  'reminders.evening': (ctx, _data, log) => sendVetFollowUpAlerts(ctx, 'evening', log),
  'vets.badges': (ctx, _data, log) => updateBadges(ctx, log),
};

export async function runJob<N extends JobName>(
  ctx: AppContext,
  name: N,
  data: JobPayloads[N],
  log: FastifyBaseLogger,
): Promise<unknown> {
  const handler = jobHandlers[name] as Handler<N>;
  return handler(ctx, data, log);
}
