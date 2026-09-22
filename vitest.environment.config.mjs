import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tools/environment-tests/**/*.contract.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
