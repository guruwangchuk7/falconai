import { test, expect } from '@playwright/test';

/**
 * T043 smoke. The signed-out checks below prove the app boots and the auth boundary holds — no DB
 * or third-party creds required. The signed-in journey (connect GitHub → see digest → search
 * decisions) is T044 and is exercised by the live quickstart run, so it's skipped here.
 */

test('the retrieval API rejects unauthenticated calls', async ({ request }) => {
  const res = await request.post('/api/retrieval', { data: { query: 'anything' } });
  expect(res.status()).toBe(401);
});

test('a connect flow bounces an unauthenticated user to sign-in', async ({ page }) => {
  await page.goto('/api/integrations/github/connect');
  await expect(page).toHaveURL(/signin/);
});

test('the sign-in page offers the GitHub provider', async ({ page }) => {
  await page.goto('/api/auth/signin');
  await expect(page.locator('body')).toContainText(/github/i);
});

test('the app boots: / redirects into the dashboard shell', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status() ?? 0).toBeLessThan(400);
  await expect(page).toHaveURL(/integrations|signin/);
});

// T044 (needs a seeded session + real GitHub/Voyage/Anthropic creds — run during the live quickstart):
test.skip('signed-in: connect GitHub → digest → search decisions', async () => {
  // 1. Sign in (GitHub OAuth or a seeded test session).
  // 2. /integrations → Connect GitHub → connection shows active + lastSyncedAt.
  // 3. /me/digest shows a summary; edit persists (effectiveText).
  // 4. /decisions?q=... returns confirmed-only, recency-ranked results.
});
