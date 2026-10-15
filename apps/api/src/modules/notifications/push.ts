import type { FastifyBaseLogger } from 'fastify';

/** One push message (Expo push API fields we use). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: 'high' | 'normal';
  /** Android channel; the app creates `offers` (loud) and `default`. */
  channelId: 'offers' | 'default';
  /** Seconds the push may wait for an offline device; offers are useless after the countdown. */
  ttl?: number;
}

export type PushTicket =
  | { ok: true; id: string }
  /** `DeviceNotRegistered` means the token is dead: stop using it. */
  | { ok: false; error: string };

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

/** Expo push service (FCM + APNs). https://docs.expo.dev/push-notifications/sending-notifications/ */
export function expoPushSender(options: {
  accessToken?: string | undefined;
  fetch?: typeof fetch;
}): PushSender {
  const http = options.fetch ?? fetch;
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_BATCH) {
        const batch = messages.slice(i, i + EXPO_BATCH);
        const res = await http(EXPO_SEND_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(options.accessToken && { authorization: `Bearer ${options.accessToken}` }),
          },
          body: JSON.stringify(
            batch.map((m) => ({ ...m, sound: m.priority === 'high' ? 'default' : undefined })),
          ),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Expo push failed: HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: { status: string; id?: string; details?: { error?: string }; message?: string }[];
        };
        for (const t of json.data ?? []) {
          tickets.push(
            t.status === 'ok' && t.id
              ? { ok: true, id: t.id }
              : { ok: false, error: t.details?.error ?? t.message ?? 'unknown' },
          );
        }
      }
      return tickets;
    },
  };
}

/** `PUSH_MODE=log` (dev): print instead of sending. Tokens are never logged in full. */
export function logPushSender(log: FastifyBaseLogger): PushSender {
  let n = 0;
  return {
    async send(messages) {
      return messages.map((m) => {
        log.info(
          { push: { to: `${m.to.slice(0, 18)}…`, title: m.title, data: m.data } },
          'push (PUSH_MODE=log, not sent)',
        );
        n += 1;
        return { ok: true as const, id: `log-${n}` };
      });
    },
  };
}
