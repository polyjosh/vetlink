import { defineConfig, devices } from '@playwright/test';

// Started by `pnpm test:e2e` (apps/api/scripts/e2e-stack.ts), which runs the API, worker and this
// app against a throwaway database and passes E2E_BASE_URL.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Low-end Android first (§4): a small phone viewport.
  projects: [{ name: 'android', use: { ...devices['Pixel 5'] } }],
});
