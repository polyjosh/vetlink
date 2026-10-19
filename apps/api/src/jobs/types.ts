import type { BookingEvent } from '@vetlink/shared';
import type { NotifyInput } from '../modules/notifications/service.js';

/**
 * Background jobs. Producers (API, webhooks) call `ctx.jobs.add`; the worker process runs the
 * handlers (BullMQ). Tests use an inline runner so job effects are deterministic.
 */
export interface JobPayloads {
  /** A Daraja STK result (callback or simulated); processed with retries. */
  'payments.stk-result': {
    checkoutRequestId: string;
    resultCode: number;
    resultDesc: string;
    receipt?: string | undefined;
    amount?: number | undefined;
  };
  /** Query stuck payments, fail stale ones, expire unpaid bookings (every minute). */
  'payments.reconcile': Record<string, never>;
  /** Notifications and dispatch after a booking change has committed. */
  'bookings.after-transition': { bookingId: number; event: BookingEvent };
  /** Send one wave of offers. */
  'matching.dispatch': { bookingId: number; wave: number };
  /** A wave's countdown ended, or everyone in it declined. */
  'matching.wave-timeout': { bookingId: number; wave: number };
  /** Still unmatched at the deadline: cancel and refund. */
  'matching.give-up': { bookingId: number };
  /** Route a notification (push, then SMS). */
  'notifications.send': NotifyInput;
  /** Deliver a notification held back by quiet hours. */
  'notifications.deliver': { notificationId: number };
  /** The app did not confirm a critical push in time: send the SMS. */
  'notifications.sms-fallback': { notificationId: number };
  /** Daily: licence expiry warnings and auto-suspension. */
  'vets.licence-check': Record<string, never>;
  /** Daily 07:00 EAT: farmer reminders due today, vets' follow-ups today (§8.8, §24.4). */
  'reminders.morning': Record<string, never>;
  /** Daily 18:00 EAT: vets' follow-ups tomorrow. */
  'reminders.evening': Record<string, never>;
  /** Every minute: chosen-vet bookings whose clock ran out move on (§24.6). */
  'bookings.deadlines': Record<string, never>;
  /** Nightly 02:00 EAT: recompute vet badges (§24.8). */
  'vets.badges': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface JobOptions {
  /** Deduplicates: a second job with the same id is ignored while the first exists. */
  jobId?: string;
  delayMs?: number;
}

export interface Jobs {
  add<N extends JobName>(name: N, data: JobPayloads[N], options?: JobOptions): Promise<void>;
}
