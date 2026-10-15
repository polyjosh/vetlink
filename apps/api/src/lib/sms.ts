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

export function createSmsSender(mode: SmsMode, log: FastifyBaseLogger, appEnv: AppEnv): SmsSender {
  if (mode === 'log') return logSmsSender(log, appEnv);
  // Africa's Talking sending arrives with the SMS integration (M9). Fail at startup rather
  // than silently dropping OTPs.
  throw new Error(`SMS_MODE=${mode} is not implemented yet; use SMS_MODE=log`);
}
