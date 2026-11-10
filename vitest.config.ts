import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globalSetup: ['packages/core/test/global-setup.ts'],
    // Database tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // The calculation engine is the part people's plans depend on; hold it to full coverage.
      include: ['packages/calc/src/**'],
      thresholds: { 100: true },
    },
  },
});
