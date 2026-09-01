import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/support/fixture';

/**
 * T028 authed e2e config. Unlike the T043 smoke config, there is NO `webServer`: global-setup boots
 * the whole stack (testcontainer Postgres + Redis, seed, and `next dev` with the offline LLM seam)
 * and tears it down. Scoped to the authed *.e2e.spec.ts suites so it doesn't also pick up the smoke
 * suite. Run with `pnpm --filter @falcon/web e2e:auth` (needs Docker + `playwright install chromium`).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /\.e2e\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
