import type { Db } from './db/client.js';
import type { Counters } from './lib/counters.js';
import { fieldCrypto, secretHasher, type FieldCrypto } from './lib/crypto.js';
import type { Jobs } from './jobs/types.js';
import type { SmsSender } from './lib/sms.js';
import type { PushSender } from './modules/notifications/push.js';
import type { PaymentsGateway } from './modules/payments/gateway.js';
import { accessTokens, type AccessTokens } from './modules/auth/tokens.js';

/** Services shared by route handlers. Built once at startup; tests build their own. */
export interface AppContext {
  db: Db;
  counters: Counters;
  sms: SmsSender;
  /** App push (Expo, or log in dev). Only the notification router uses it. */
  push: PushSender;
  /** M-Pesa STK push (Daraja or mock, by PAYMENTS_MODE). */
  payments: PaymentsGateway;
  /** Background jobs (BullMQ in the app; inline in tests). */
  jobs: Jobs;
  crypto: FieldCrypto;
  tokens: AccessTokens;
  hashOtp: (code: string) => string;
  hashRecoveryCode: (code: string) => string;
  /** All business time comes from here (never SQL `now()`), so expiry is testable. */
  clock: () => Date;
  /** Dev shortcut (config rejects it in production). */
  otpFixedCode: string | undefined;
}

export interface ContextOptions {
  db: Db;
  counters: Counters;
  sms: SmsSender;
  push: PushSender;
  payments: PaymentsGateway;
  jobs: Jobs;
  dataEncryptionKey: string;
  jwtSecret: string;
  otpFixedCode?: string | undefined;
  clock?: () => Date;
}

export function createContext(o: ContextOptions): AppContext {
  return {
    db: o.db,
    counters: o.counters,
    sms: o.sms,
    push: o.push,
    payments: o.payments,
    jobs: o.jobs,
    crypto: fieldCrypto(o.dataEncryptionKey),
    tokens: accessTokens(o.jwtSecret),
    hashOtp: secretHasher(o.dataEncryptionKey, 'otp'),
    hashRecoveryCode: secretHasher(o.dataEncryptionKey, 'admin-recovery-code'),
    clock: o.clock ?? (() => new Date()),
    otpFixedCode: o.otpFixedCode,
  };
}
