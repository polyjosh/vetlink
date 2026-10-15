import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
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
