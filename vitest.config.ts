import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    hookTimeout: 180_000, // Testcontainers image pull + start
    testTimeout: 60_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@falcon/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@falcon/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@falcon/llm': fileURLToPath(new URL('./packages/llm/src/index.ts', import.meta.url)),
      '@falcon/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@falcon/integrations': fileURLToPath(new URL('./packages/integrations/src/index.ts', import.meta.url)),
    },
  },
});
