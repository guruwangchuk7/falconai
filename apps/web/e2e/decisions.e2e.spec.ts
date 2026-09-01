import { test, expect } from '@playwright/test';
import { mintSessionCookie } from './support/session';
import { A, UA, BASE_URL } from './support/fixture';

/**
 * Feature 005 (Decision Memory) US1 e2e — the write path through the real Next server (booted by
 * global-setup against testcontainer Postgres + Redis, offline LLM seam). Sign in via a minted
 * cookie → log a decision → confirm it from the queue → it becomes searchable → open its detail view.
 */

test('authed: log a decision → confirm → search finds it → detail opens', async ({ page, context }) => {
  await context.addCookies([await mintSessionCookie(UA, A, BASE_URL)]);

  const title = 'Adopt Deepgram as primary STT';

  // Log a decision.
  await page.goto('/decisions/new');
  await expect(page.getByRole('heading', { name: 'Log a decision' })).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder('e.g. Adopt Deepgram as primary STT').fill(title);
  await page.getByPlaceholder('What was decided').fill('Deepgram Nova, AssemblyAI failover');
  await page.getByRole('button', { name: 'Log decision' }).click();

  // Redirected to the queue; confirm the record (human-in-the-loop gate).
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  // After confirmation it leaves the queue and becomes retrievable via search.
  await page.goto('/decisions?q=deepgram');
  const result = page.getByRole('link', { name: title });
  await expect(result).toBeVisible({ timeout: 30_000 });

  // Detail view shows the confirmed status.
  await result.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: false })).toBeVisible();
});

test('unauthed: capturing a decision is refused without a session (401)', async ({ request }) => {
  const res = await request.post('/api/decisions', { data: { title: 'x' } });
  expect(res.status()).toBe(401);
});
