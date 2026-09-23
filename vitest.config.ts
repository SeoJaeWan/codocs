import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@codocs/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@codocs/workspace': fileURLToPath(
        new URL('./packages/workspace/src/index.ts', import.meta.url),
      ),
      '@codocs/mcp': fileURLToPath(
        new URL('./packages/mcp/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tools/test/support/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
