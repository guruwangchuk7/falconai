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
      '@falcon/stt': fileURLToPath(new URL('./packages/stt/src/index.ts', import.meta.url)),
      '@falcon/session-core': fileURLToPath(new URL('./packages/session-core/src/index.ts', import.meta.url)),
      // Alias these so vi.mock() can intercept them reliably: under pnpm's symlinked store an
      // un-aliased workspace specifier resolves to a path vi.mock can't match (route tests mock them).
      '@falcon/queue': fileURLToPath(new URL('./packages/queue/src/index.ts', import.meta.url)),
      '@falcon/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
      '@falcon/secrets': fileURLToPath(new URL('./packages/secrets/src/index.ts', import.meta.url)),
      // apps/web tsconfig path ("@/*" → "./*"); lets tests exercise the real Next route handlers.
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
});
