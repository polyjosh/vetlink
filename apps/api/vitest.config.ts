import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@vetlink/source'] },
  ssr: { resolve: { conditions: ['@vetlink/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
