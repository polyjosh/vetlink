import { defineConfig } from 'drizzle-kit';

// `db:generate` needs no database. `db:studio` runs on the host and uses DATABASE_URL from .env.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
