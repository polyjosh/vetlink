import type { Db } from './db/client.js';
import type { Counters } from './lib/counters.js';
import { fieldCrypto, secretHasher, type FieldCrypto } from './lib/crypto.js';
import type { SmsSender } from './lib/sms.js';
import { accessTokens, type AccessTokens } from './modules/auth/tokens.js';

/** Services shared by route handlers. Built once at startup; tests build their own. */
export interface AppContext {
  db: Db;
  counters: Counters;
  sms: SmsSender;
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
    crypto: fieldCrypto(o.dataEncryptionKey),
    tokens: accessTokens(o.jwtSecret),
    hashOtp: secretHasher(o.dataEncryptionKey, 'otp'),
    hashRecoveryCode: secretHasher(o.dataEncryptionKey, 'admin-recovery-code'),
    clock: o.clock ?? (() => new Date()),
    otpFixedCode: o.otpFixedCode,
  };
}
