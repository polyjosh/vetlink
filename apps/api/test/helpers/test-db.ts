import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export const testServerUrl = process.env.TEST_DATABASE_URL;
// CI must never skip DB tests silently.
if (process.env.CI && !testServerUrl) throw new Error('TEST_DATABASE_URL must be set in CI');

// CREATE DATABASE plus the migrations is fsync-heavy: ~12s on a WSL2 Docker volume.
export const DB_SETUP_TIMEOUT_MS = 60_000;

export interface TestDatabase {
  url: string;
  handle: DbHandle;
  drop: () => Promise<void>;
}

/** A throwaway, migrated database on the TEST_DATABASE_URL server. Never the dev data. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = testServerUrl ?? '';
  const name = `vetlink_test_${randomBytes(4).toString('hex')}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const u = new URL(serverUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  return {
    url,
    handle,
    drop: async () => {
      await handle.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
