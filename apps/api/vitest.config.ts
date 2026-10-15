import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// DB and Redis integration tests need TEST_DATABASE_URL / TEST_REDIS_URL (set in CI). Locally,
// take only those variables from the repo-root .env so the rest of the file never leaks into tests.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) {
  const env = parseEnv(readFileSync(rootEnv, 'utf8'));
  for (const name of ['TEST_DATABASE_URL', 'TEST_REDIS_URL'] as const) {
    const value = env[name];
    if (!process.env[name] && value) process.env[name] = value;
  }
}

export default defineConfig({
  resolve: { conditions: ['@vetlink/source'] },
  ssr: { resolve: { conditions: ['@vetlink/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every app build loads Swagger and zod schemas, and many tests hit Postgres; under a busy
    // machine (Docker, parallel files) 5 s is too tight. Real hangs still fail.
    testTimeout: 30_000,
  },
});
