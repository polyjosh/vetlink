import { pino } from 'pino';
import { loggerOptions } from '../lib/logger.js';
import { runMigrations } from './migrate.js';

// Entry point: `docker compose run --rm migrate` locally, `start:migrate` as a CI/CD step in
// production. Kept separate from migrate.ts so importing the library never runs it and running
// this file always does (no "am I the main module" check that a wrapper could defeat).
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
