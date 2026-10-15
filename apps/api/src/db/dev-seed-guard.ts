import type { Sql } from 'postgres';
import type { AppEnv } from '@vetlink/shared';
import { ConfigError } from '../config.js';
import { createDb } from './client.js';
import { SEED_PHONES, SEED_USERS } from './seed/fixtures.js';

const SEED_USER_IDS: string[] = Object.values(SEED_USERS).map((u) => u.id);

/** How often a running production process rechecks (the startup check alone misses a seed
 * written into a database while the API is already up). */
export const DEV_SEED_WATCH_INTERVAL_MS = 60_000;

/** True if any dev seed account exists, matched by fixed ID or phone. */
async function hasDevSeedData(sql: Sql): Promise<boolean> {
  const rows = await sql`select 1 from users
    where id = any(${SEED_USER_IDS}::uuid[]) or phone = any(${SEED_PHONES}) limit 1`;
  return rows.length > 0;
}

/**
 * Invariant 9: the seeded admin (and other dev seed accounts) must never exist in production.
 * Fails startup if any seed account is found. Other environments are not checked.
 */
export async function assertNoDevSeedData(appEnv: AppEnv, databaseUrl: string): Promise<void> {
  if (appEnv !== 'production') return;
  const { sql, close } = createDb(databaseUrl, { max: 1 });
  try {
    if (await hasDevSeedData(sql)) {
      throw new ConfigError(
        'Dev seed accounts (including the seeded admin) exist with APP_ENV=production',
      );
    }
  } finally {
    await close();
  }
}

export interface DevSeedWatchOptions {
  appEnv: AppEnv;
  databaseUrl: string;
  /** Called once seed data is found; the caller must stop the process (fail closed). */
  onFound: () => void;
  /** A failed check (e.g. DB briefly down) is reported and retried on the next tick. */
  onError: (err: unknown) => void;
  intervalMs?: number;
}

/** A hung check (e.g. a dead connection) is cut off so the watch can never stall silently. */
const CHECK_TIMEOUT_MS = 10_000;

/** One check on its own short-lived connection, destroyed if it exceeds the timeout. */
async function checkOnce(databaseUrl: string): Promise<boolean> {
  const { sql, close } = createDb(databaseUrl, { max: 1 });
  const timer = setTimeout(() => void sql.end({ timeout: 0 }), CHECK_TIMEOUT_MS);
  try {
    return await hasDevSeedData(sql);
  } finally {
    clearTimeout(timer);
    await close();
  }
}

/** Production only: recheck periodically. Returns a stop function for graceful shutdown. */
export function watchForDevSeedData(options: DevSeedWatchOptions): () => Promise<void> {
  if (options.appEnv !== 'production') return async () => {};
  let checking: Promise<void> | undefined;
  let found = false;
  const timer = setInterval(() => {
    if (checking || found) return;
    checking = checkOnce(options.databaseUrl)
      .then((hit) => {
        if (hit) {
          found = true;
          options.onFound();
        }
      }, options.onError)
      .finally(() => {
        checking = undefined;
      });
  }, options.intervalMs ?? DEV_SEED_WATCH_INTERVAL_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await checking; // let an in-flight check close its connection
  };
}
