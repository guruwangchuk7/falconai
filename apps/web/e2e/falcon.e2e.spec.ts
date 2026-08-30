import { test, expect } from '@playwright/test';
import { mintSessionCookie } from './support/session';
import { A, UA, BASE_URL } from './support/fixture';

/**
 * T028 — authed Playwright e2e for the Personal Falcon panel. Drives the real Next server
 * (booted by global-setup against testcontainer Postgres + Redis, offline LLM seam): sign in via a
 * minted session cookie → open /falcon → ask → assert a GROUNDED, CITED answer renders. The answer
 * text/citation are deterministic (the offline provider grounds a claim on the seeded artifact).
 */

test('authed: ask Falcon → a grounded, cited answer renders', async ({ page, context }) => {
  await context.addCookies([await mintSessionCookie(UA, A, BASE_URL)]);

  await page.goto('/falcon');
  await expect(page.getByRole('heading', { name: 'Ask Falcon' })).toBeVisible();

  await page.getByPlaceholder('e.g. what did I do for authentication?').fill('what did I do for auth?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  // Grounded claim renders...
  await expect(page.getByText('You implemented the GitHub auth callback.')).toBeVisible({ timeout: 30_000 });
  // ...with its provenance chip (type + external ref of the cited artifact).
  await expect(page.getByText('commit sha1')).toBeVisible();
});

test('unauthed: the ask API refuses without a session (401)', async ({ request }) => {
  const res = await request.post('/api/falcon/ask', { data: { question: 'anything' } });
  expect(res.status()).toBe(401);
});
