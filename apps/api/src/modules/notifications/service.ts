import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { interpolate, messages, type Locale } from '@vetlink/i18n';
import type { ProblemType, Species } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import {
  authSessions,
  bookingOffers,
  devices,
  notifications,
  users,
} from '../../db/schema/index.js';
import { maskPhone } from '../../lib/phone.js';
import type { PushTicket } from './push.js';

/**
 * The notification router (§8.7). Business code never sends SMS or push itself: it calls
 * `notify`, which picks the channel. Push first when the user has a live app session with push
 * on; for critical events an SMS follows if the app does not confirm within 15 s; SMS only for
 * users without the app. Non-critical messages wait out quiet hours, emergencies never do.
 */

export const NOTIFICATION_KINDS = {
  offer: { critical: true },
  offerEmergency: { critical: true },
  booking_matched: { critical: true },
  vet_en_route: { critical: true },
  vet_arrived: { critical: true },
  booking_completed: { critical: false },
  still_searching: { critical: true },
  no_vet_found: { critical: true },
  booking_cancelled: { critical: true },
  application_submitted: { critical: false },
  application_changes: { critical: false },
  application_approved: { critical: false },
  application_rejected: { critical: false },
  vet_suspended: { critical: true },
  vet_reinstated: { critical: false },
  licence_expiring: { critical: false },
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export const SMS_FALLBACK_AFTER_MS = 15_000;
/** Quiet hours in Nairobi time (EAT, UTC+3): 21:00 to 06:00. */
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 6;

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  params: Record<string, string | number>;
  /** Passed to the app with the push (e.g. bookingId, offerId). Never personal data. */
  data?: Record<string, string | number>;
  /** Rendered in the recipient's language: `{animal}` and `{problem}`. */
  localized?: { animal?: Species; problem?: ProblemType };
  /** Emergencies ignore quiet hours. */
  emergency?: boolean;
}

type Payload = {
  params: NotifyInput['params'];
  localized?: NotifyInput['localized'];
  data: Record<string, unknown>;
};

export type Delivery = 'push' | 'sms' | 'deferred' | 'none';

const eatHour = (now: Date) => (now.getUTCHours() + 3) % 24;

export function isQuietHours(now: Date): boolean {
  const h = eatHour(now);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** Milliseconds until quiet hours end (06:00 EAT). */
export function msUntilQuietEnds(now: Date): number {
  const eat = new Date(now.getTime() + 3 * 3600 * 1000);
  const end = new Date(eat);
  end.setUTCHours(QUIET_END_HOUR, 0, 0, 0);
  if (end <= eat) end.setUTCDate(end.getUTCDate() + 1);
  return end.getTime() - eat.getTime();
}

function render(lang: Locale, kind: NotificationKind, payload: Payload) {
  const t = messages[lang].notify[kind];
  const params = {
    ...payload.params,
    ...(payload.localized?.animal && {
      animal: messages[lang].ussd.species[payload.localized.animal],
    }),
    ...(payload.localized?.problem && {
      problem: messages[lang].ussd.problems[payload.localized.problem],
    }),
  };
  return {
    title: interpolate(t.title, params),
    body: interpolate(t.body, params),
    sms: interpolate(t.sms, params),
  };
}

/** Record a notification and deliver it (or schedule it after quiet hours). */
export async function notify(
  ctx: AppContext,
  input: NotifyInput,
  log: FastifyBaseLogger,
): Promise<{ id: number; via: Delivery }> {
  const critical = NOTIFICATION_KINDS[input.kind].critical || Boolean(input.emergency);
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      payload: {
        params: input.params,
        ...(input.localized && { localized: input.localized }),
        data: input.data ?? {},
      } satisfies Payload,
      critical,
      createdAt: ctx.clock(),
    })
    .returning({ id: notifications.id });
  if (!row) throw new Error('notification insert failed');

  if (!critical && isQuietHours(ctx.clock())) {
    await ctx.jobs.add(
      'notifications.deliver',
      { notificationId: row.id },
      { jobId: `deliver-${row.id}`, delayMs: msUntilQuietEnds(ctx.clock()) },
    );
    return { id: row.id, via: 'deferred' };
  }
  return { id: row.id, via: await deliver(ctx, row.id, log) };
}

/** Push to every live app install, else SMS. Exactly-once per channel (guarded columns). */
export async function deliver(
  ctx: AppContext,
  notificationId: number,
  log: FastifyBaseLogger,
): Promise<Delivery> {
  const [n] = await ctx.db
    .select({
      n: notifications,
      phone: users.phone,
      language: users.language,
      deletedAt: users.deletedAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!n || n.deletedAt) return 'none';
  if (n.n.pushSentAt || n.n.smsSentAt) return n.n.pushSentAt ? 'push' : 'sms'; // already done

  const kind = n.n.kind as NotificationKind;
  const payload = n.n.payload as Payload;
  const text = render(n.language, kind, payload);
  const now = ctx.clock();

  // Live installs: a device with a push token, push switched on, and a signed-in session.
  const installs = await ctx.db
    .selectDistinct({ deviceId: devices.id, token: devices.pushToken })
    .from(devices)
    .innerJoin(authSessions, eq(authSessions.deviceId, devices.id))
    .where(
      and(
        eq(devices.userId, n.n.userId),
        isNotNull(devices.pushToken),
        eq(devices.notificationsEnabled, true),
        isNull(authSessions.revokedAt),
      ),
    );

  if (installs.length > 0) {
    const isOffer = kind === 'offer' || kind === 'offerEmergency';
    let tickets: PushTicket[];
    try {
      tickets = await ctx.push.send(
        installs.map((d) => ({
          to: d.token as string,
          title: text.title,
          body: text.body,
          data: { ...payload.data, kind, notificationId },
          priority: n.n.critical ? 'high' : 'normal',
          channelId: isOffer ? 'offers' : 'default',
          ...(isOffer && { ttl: 120 }),
        })),
      );
    } catch (err) {
      log.warn({ err, notificationId }, 'push send failed; using SMS');
      tickets = [];
    }
    const dead = installs.filter((_, i) => {
      const t = tickets[i];
      return t && !t.ok && t.error === 'DeviceNotRegistered';
    });
    if (dead.length > 0) {
      await ctx.db
        .update(devices)
        .set({ pushToken: null })
        .where(
          inArray(
            devices.id,
            dead.map((d) => d.deviceId),
          ),
        );
    }
    const ok = tickets.find((t): t is { ok: true; id: string } => Boolean(t?.ok));
    if (ok) {
      await ctx.db
        .update(notifications)
        .set({ pushSentAt: now, pushTicketId: ok.id })
        .where(eq(notifications.id, notificationId));
      if (n.n.critical) {
        await ctx.jobs.add(
          'notifications.sms-fallback',
          { notificationId },
          { jobId: `fallback-${notificationId}`, delayMs: SMS_FALLBACK_AFTER_MS },
        );
      }
      return 'push';
    }
    const firstError = tickets.find((t) => t && !t.ok);
    await ctx.db
      .update(notifications)
      .set({
        pushError: firstError && !firstError.ok ? firstError.error.slice(0, 100) : 'no_ticket',
      })
      .where(eq(notifications.id, notificationId));
  }

  await sendSms(ctx, notificationId, n.phone, text.sms, log);
  return 'sms';
}

async function sendSms(
  ctx: AppContext,
  notificationId: number,
  phone: string | null,
  text: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!phone) return;
  // Claim the SMS first so a retried job never texts twice.
  const claimed = await ctx.db
    .update(notifications)
    .set({ smsSentAt: ctx.clock() })
    .where(and(eq(notifications.id, notificationId), isNull(notifications.smsSentAt)))
    .returning({ id: notifications.id });
  if (claimed.length === 0) return;
  try {
    await ctx.sms.send(phone, text);
  } catch (err) {
    // Release the claim so the job retry can send it.
    await ctx.db
      .update(notifications)
      .set({ smsSentAt: null })
      .where(eq(notifications.id, notificationId));
    log.error({ err, notificationId, phone: maskPhone(phone) }, 'SMS notification failed');
    throw err;
  }
}

/**
 * 15 s after a critical push: if the app has not confirmed it, send the SMS too (§8.7).
 * For job offers, record that the offer went out on both channels.
 */
export async function smsFallback(
  ctx: AppContext,
  notificationId: number,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const [n] = await ctx.db
    .select({ n: notifications, phone: users.phone, language: users.language })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!n || n.n.readAt || n.n.smsSentAt) return false;
  const kind = n.n.kind as NotificationKind;
  const payload = n.n.payload as Payload;
  await sendSms(ctx, notificationId, n.phone, render(n.language, kind, payload).sms, log);
  if (payload.data.offerId) {
    await ctx.db
      .update(bookingOffers)
      .set({ channel: 'both' })
      .where(eq(bookingOffers.id, Number(payload.data.offerId)));
  }
  return true;
}

/** The app confirms a notification arrived (stops the SMS fallback) or was read. */
export async function markRead(
  ctx: AppContext,
  userId: string,
  notificationId: number,
): Promise<boolean> {
  const updated = await ctx.db
    .update(notifications)
    .set({ readAt: ctx.clock() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  if (updated.length > 0) return true;
  const [exists] = await ctx.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  return Boolean(exists);
}
