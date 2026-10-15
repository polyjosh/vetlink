import { z } from 'zod';
import { APP_ENVS, PAYMENTS_MODES, SMS_MODES } from '@vetlink/shared';
import { parseMasterKey } from './lib/crypto.js';

const envSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Reverse proxies whose X-Forwarded-For is trusted, so per-IP OTP limits see the real client
  // address instead of the proxy's: comma-separated proxy IPs/CIDRs or the presets `loopback`,
  // `linklocal`, `uniquelocal`. Hop counts are not accepted: they cannot check who the immediate
  // peer is, so a direct client could forge X-Forwarded-For and dodge per-IP limits.
  // Empty (default) trusts nobody: right when the API is reached directly, as in local dev.
  TRUST_PROXY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(
        /^(loopback|linklocal|uniquelocal|[0-9a-fA-F.:/]+)(\s*,\s*(loopback|linklocal|uniquelocal|[0-9a-fA-F.:/]+))*$/,
        {
          message: 'must be comma-separated proxy IPs/CIDRs or loopback/linklocal/uniquelocal',
        },
      )
      .transform((v) => v.split(',').map((x) => x.trim()))
      .refine(
        (entries) =>
          entries.every(
            (e) => ['loopback', 'linklocal', 'uniquelocal'].includes(e) || /[.:]/.test(e),
          ),
        { message: 'hop counts are not allowed; list the proxy IPs/CIDRs' },
      )
      .optional(),
  ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SMS_MODE: z.enum(SMS_MODES),
  PAYMENTS_MODE: z.enum(PAYMENTS_MODES),
  // Oldest app version still supported; older apps are asked to update (§10).
  MIN_APP_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, { message: 'must be MAJOR.MINOR.PATCH' })
    .default('1.0.0'),
  // Shared secret Africa's Talking sends as `?token=` on webhook URLs. Required in production.
  WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(24, { message: 'must be at least 24 characters' }).optional(),
  ),
  // Safaricom Daraja (PAYMENTS_MODE=sandbox|live). PUBLIC_BASE_URL is where callbacks arrive.
  PUBLIC_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  DARAJA_CONSUMER_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  DARAJA_CONSUMER_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  DARAJA_SHORTCODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^\d{5,7}$/, { message: 'must be 5 to 7 digits' })
      .optional(),
  ),
  DARAJA_PASSKEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // App push: `log` prints (dev only; refused in production), `expo` sends via Expo.
  PUSH_MODE: z.enum(['log', 'expo']).default('log'),
  EXPO_ACCESS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // HS256 key for access tokens: `openssl rand -base64 32`.
  JWT_SECRET: z.string().min(32, { message: 'must be at least 32 characters' }),
  // Dev shortcut: every OTP is this code. Empty means off.
  OTP_FIXED_CODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^\d{6}$/, { message: 'must be 6 digits' })
      .optional(),
  ),
  // Master key for field encryption (national IDs, TOTP secrets): `openssl rand -base64 32`.
  DATA_ENCRYPTION_KEY: z.string().refine(
    (v) => {
      try {
        parseMasterKey(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be 32 bytes, base64-encoded' },
  ),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Dev-only shortcuts that must never be on in production (CLAUDE.md invariant 9).
 * The seeded dev admin is checked against the database at startup (db/dev-seed-guard.ts).
 */
function devShortcutsEnabled(config: Config): string[] {
  const enabled: string[] = [];
  if (config.SMS_MODE === 'log') enabled.push('SMS_MODE=log');
  if (config.PAYMENTS_MODE === 'mock') enabled.push('PAYMENTS_MODE=mock');
  if (config.OTP_FIXED_CODE !== undefined) enabled.push('OTP_FIXED_CODE');
  if (config.PUSH_MODE === 'log') enabled.push('PUSH_MODE=log');
  return enabled;
}

/** Parse and validate the environment. Throws `ConfigError`; never echoes values (they may be secrets). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n  ${fields.join('\n  ')}`);
  }
  const config = parsed.data;
  if (config.PAYMENTS_MODE !== 'mock') {
    const missing = (
      [
        'PUBLIC_BASE_URL',
        'WEBHOOK_SECRET',
        'DARAJA_CONSUMER_KEY',
        'DARAJA_CONSUMER_SECRET',
        'DARAJA_SHORTCODE',
        'DARAJA_PASSKEY',
      ] as const
    ).filter((k) => !config[k]);
    if (missing.length > 0) {
      throw new ConfigError(`PAYMENTS_MODE=${config.PAYMENTS_MODE} needs: ${missing.join(', ')}`);
    }
  }
  if (config.APP_ENV === 'production' && !config.WEBHOOK_SECRET) {
    throw new ConfigError('WEBHOOK_SECRET is required with APP_ENV=production');
  }
  if (config.APP_ENV === 'production') {
    const shortcuts = devShortcutsEnabled(config);
    if (shortcuts.length > 0) {
      throw new ConfigError(
        `Dev-only shortcuts are enabled with APP_ENV=production: ${shortcuts.join(', ')}`,
      );
    }
  }
  return config;
}
