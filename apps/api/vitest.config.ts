import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// DB integration tests need TEST_DATABASE_URL (set in CI). Locally, take only that one
// variable from the repo-root .env so the rest of the file never leaks into tests.
const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.TEST_DATABASE_URL && existsSync(rootEnv)) {
  const url = parseEnv(readFileSync(rootEnv, 'utf8')).TEST_DATABASE_URL;
  if (url) process.env.TEST_DATABASE_URL = url;
}

export default defineConfig({
  resolve: { conditions: ['@vetlink/source'] },
  ssr: { resolve: { conditions: ['@vetlink/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
