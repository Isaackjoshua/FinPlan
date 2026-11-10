import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globalSetup: ['packages/core/test/global-setup.ts'],
    // Database tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
  },
});
