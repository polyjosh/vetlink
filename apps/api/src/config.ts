import { z } from 'zod';
import { APP_ENVS, PAYMENTS_MODES, SMS_MODES } from '@vetlink/shared';
import { parseMasterKey } from './lib/crypto.js';

const envSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SMS_MODE: z.enum(SMS_MODES),
  PAYMENTS_MODE: z.enum(PAYMENTS_MODES),
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
 * M3 adds the fixed OTP here.
 */
function devShortcutsEnabled(config: Config): string[] {
  const enabled: string[] = [];
  if (config.SMS_MODE === 'log') enabled.push('SMS_MODE=log');
  if (config.PAYMENTS_MODE === 'mock') enabled.push('PAYMENTS_MODE=mock');
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
