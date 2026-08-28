import { defineConfig, devices } from '@playwright/test';

/**
 * T043 smoke config. The unauthenticated checks in e2e/smoke.spec.ts need only a running app
 * (no DB/creds). The full authed flow (connect→digest→decisions) is T044 and runs during the live
 * quickstart. Start the app first (needs at least AUTH_SECRET); `webServer` will reuse it if up.
 * Override the target with PLAYWRIGHT_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @falcon/web dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
