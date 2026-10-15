import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { pino } from 'pino';
import { loggerOptions } from '../lib/logger.js';
import { createDb } from './client.js';

/** Committed SQL migrations. The build copies them next to the compiled script. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Apply every pending migration. Forward-only: never edit an applied migration. */
export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

// Entry point: `docker compose run --rm migrate` locally, a CI/CD step in production.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = pino(loggerOptions(process.env.LOG_LEVEL ?? 'info'));
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.fatal('DATABASE_URL is not set');
    process.exit(1);
  }
  try {
    await runMigrations(url);
    log.info('migrations applied');
  } catch (err) {
    log.fatal({ err }, 'migration failed');
    process.exit(1);
  }
}
