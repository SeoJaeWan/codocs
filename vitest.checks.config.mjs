import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tools/development-checks/**/*.test.ts',
      'tools/build/check/**/*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
