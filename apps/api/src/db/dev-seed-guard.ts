import type { AppEnv } from '@vetlink/shared';
import { ConfigError } from '../config.js';
import { createDb } from './client.js';
import { SEED_PHONES } from './seed/fixtures.js';

/**
 * Invariant 9: the seeded admin (and other dev seed accounts) must never exist in production.
 * Fails startup if any seed account is found. Other environments are not checked.
 */
export async function assertNoDevSeedData(appEnv: AppEnv, databaseUrl: string): Promise<void> {
  if (appEnv !== 'production') return;
  const { sql, close } = createDb(databaseUrl, { max: 1 });
  try {
    const rows = await sql`select 1 from users where phone = any(${SEED_PHONES}) limit 1`;
    if (rows.length > 0) {
      throw new ConfigError(
        'Dev seed accounts (including the seeded admin) exist with APP_ENV=production',
      );
    }
  } finally {
    await close();
  }
}
