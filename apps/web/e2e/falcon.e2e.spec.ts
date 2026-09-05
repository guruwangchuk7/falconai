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
  // The page leads with a time-of-day greeting now; assert the stable intro copy + ask control instead.
  await expect(page.getByText('Ask about your work and your team', { exact: false })).toBeVisible();

  await page.getByPlaceholder('e.g. what did I do for authentication?').fill('what did I do for auth?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  // Grounded claim renders...
  await expect(page.getByText('You implemented the GitHub auth callback.')).toBeVisible({ timeout: 30_000 });
  // ...with its provenance as an OPENABLE link (type + external ref → the real GitHub commit URL).
  const citation = page.getByRole('link', { name: 'commit sha1' });
  await expect(citation).toBeVisible();
  await expect(citation).toHaveAttribute('href', 'https://github.com/octo/repo-a/commit/sha1');

  // History view: the conversation we just created is listed and opens to show the turn.
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: /what did I do for auth/ }).click();
  await expect(page.getByText('You asked', { exact: false })).toBeVisible();
  await expect(page.getByText('You implemented the GitHub auth callback.')).toBeVisible();
});

test('unauthed: the ask API refuses without a session (401)', async ({ request }) => {
  const res = await request.post('/api/falcon/ask', { data: { question: 'anything' } });
  expect(res.status()).toBe(401);
});
