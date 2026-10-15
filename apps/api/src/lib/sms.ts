import type { FastifyBaseLogger } from 'fastify';
import type { SmsMode } from '@vetlink/shared';
import { maskPhone } from './phone.js';

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/**
 * `SMS_MODE=log`: print the message instead of sending it (dev only; config refuses it in
 * production). The text is logged because it is the only way to read a dev OTP; the number is
 * masked as everywhere else.
 */
export function logSmsSender(log: FastifyBaseLogger): SmsSender {
  return {
    async send(phone, text) {
      log.info({ sms: { to: maskPhone(phone), text } }, 'SMS (SMS_MODE=log, not sent)');
    },
  };
}

export function createSmsSender(mode: SmsMode, log: FastifyBaseLogger): SmsSender {
  if (mode === 'log') return logSmsSender(log);
  // Africa's Talking sending arrives with the SMS integration (M9). Fail at startup rather
  // than silently dropping OTPs.
  throw new Error(`SMS_MODE=${mode} is not implemented yet; use SMS_MODE=log`);
}
