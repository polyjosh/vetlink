import type { FastifyBaseLogger } from 'fastify';
import type { AppEnv, SmsMode } from '@vetlink/shared';
import { maskPhone } from './phone.js';

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Environments where the log sender may print codes: the only way to read a dev OTP there. */
const REVEAL_CODES_IN: readonly AppEnv[] = ['development', 'test'];

/**
 * `SMS_MODE=log`: print the message instead of sending it (config refuses it in production).
 * The number is always masked. Codes (any run of 4+ digits) are printed only in development and
 * test; elsewhere, such as staging with real numbers, they are masked and logins there use
 * `OTP_FIXED_CODE` instead.
 */
export function logSmsSender(log: FastifyBaseLogger, appEnv: AppEnv): SmsSender {
  const reveal = REVEAL_CODES_IN.includes(appEnv);
  return {
    async send(phone, text) {
      const shown = reveal ? text : text.replace(/\d{4,}/g, '****');
      log.info({ sms: { to: maskPhone(phone), text: shown } }, 'SMS (SMS_MODE=log, not sent)');
    },
  };
}

export interface AfricasTalkingConfig {
  /** `sandbox` for the sandbox app. */
  username: string;
  apiKey: string;
  /** Registered sender ID (alphanumeric or shortcode); omitted uses the account default. */
  senderId?: string | undefined;
  fetch?: typeof fetch;
}

/**
 * Africa's Talking SMS (§14). Endpoint and fields as the official SDK sends them:
 * `POST https://api[.sandbox].africastalking.com/version1/messaging`, form-encoded
 * `username, to, message, from?`, header `apikey`; HTTP 201 on success.
 */
export function africasTalkingSender(config: AfricasTalkingConfig): SmsSender {
  const sandbox = config.username.toLowerCase() === 'sandbox';
  const url = `https://api.${sandbox ? 'sandbox.' : ''}africastalking.com/version1/messaging`;
  const http = config.fetch ?? fetch;
  return {
    async send(phone, text) {
      const body = new URLSearchParams({
        username: config.username,
        to: `+${phone}`,
        message: text,
        bulkSMSMode: '1',
      });
      if (config.senderId) body.set('from', config.senderId);
      const res = await http(url, {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`Africa's Talking SMS failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        SMSMessageData?: { Recipients?: { status?: string; statusCode?: number }[] };
      };
      const recipient = json.SMSMessageData?.Recipients?.[0];
      // 100 Processed, 101 Sent, 102 Queued: accepted. Anything else is a failure.
      if (!recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
        throw new Error(
          `Africa's Talking rejected the SMS (${recipient?.status ?? 'no recipient'})`,
        );
      }
    },
  };
}

export function createSmsSender(
  mode: SmsMode,
  log: FastifyBaseLogger,
  appEnv: AppEnv,
  at?: AfricasTalkingConfig,
): SmsSender {
  if (mode === 'log') return logSmsSender(log, appEnv);
  if (!at) throw new Error(`SMS_MODE=${mode} needs Africa's Talking settings`);
  return africasTalkingSender(at);
}
