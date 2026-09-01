import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startTestDb } from '../../../tests/support/pg';
import { startTestRedis } from '../../../tests/support/redis';

// Pinned embedding model/version (source of truth: packages/llm EMBEDDING_MODEL/VERSION). Inlined
// rather than imported so Playwright's Node loader doesn't strip-parse the whole @falcon/llm .ts.
const EMBEDDING_MODEL = 'voyage-code-4';
const EMBEDDING_VERSION = 'voyage-code-4';
import { A, ART, UA, BASE_URL, PORT, TEST_AUTH_SECRET } from './support/fixture';

/**
 * Global setup for the authed e2e (T028). Boots a pgvector Postgres + a Redis (Testcontainers),
 * applies both migrations, seeds one tenant with a synced auth artifact, then launches `next dev`
 * wired to those containers with the offline FALCON_FAKE_LLM seam — so the whole "ask → grounded,
 * cited answer" flow runs deterministically with NO API keys. Returns a teardown that stops
 * everything. Requires Docker.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(HERE, '..');
const M2 = resolve(HERE, '../../../packages/db/drizzle/0002_personal_falcon.sql');
const M4 = resolve(HERE, '../../../packages/db/drizzle/0004_decision_dismissed_at.sql'); // feature 005
const VEC = `[${Array(1024).fill(0.1).join(',')}]`; // matches fake-llm's constant query embedding

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`Next dev server did not become ready at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export default async function globalSetup() {
  // 1. Postgres (reuses the integration-test bootstrap: applies 0001 + creates the falcon_app role).
  const tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  await tdb.admin.unsafe(readFileSync(M4, 'utf8')); // decision_record.dismissed_at (feature 005)

  // Seed one tenant: workspace A, user UA, and one auth-related artifact + embedded chunk UA owns.
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'e2e@x.com' }, 'id', 'email')}`;
  await tdb.admin`insert into artifact (id, workspace_id, user_id, source, external_ref, type, title, repo_or_project, acl_tags, trust_tier, source_updated_at, last_synced_at)
    values (${ART}, ${A}, ${UA}, 'github', 'sha1', 'commit', 'auth commit', 'octo/repo-a', '["repo-a"]'::jsonb, 'trusted', now(), now())`;
  await tdb.admin`insert into artifact_chunk (workspace_id, artifact_id, chunk_index, content, trust_tier, embedding, embedding_model, embedding_version)
    values (${A}, ${ART}, 0, 'implemented the GitHub auth callback', 'trusted', ${VEC}::vector, ${EMBEDDING_MODEL}, ${EMBEDDING_VERSION})`;

  // 2. Redis (rate limiter / queue connection).
  const redis = await startTestRedis();
  const redisUrl = redis.url;

  // 3. Expose the shared secret + base URL to the test workers (forked after this returns).
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.PLAYWRIGHT_BASE_URL = BASE_URL;

  // 4. Launch `next dev` (development → the non-prod FALCON_FAKE_LLM seam is honored).
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve('next/dist/bin/next');
  const server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      DATABASE_URL: tdb.adminUrl,
      APP_DATABASE_URL: tdb.appUrl,
      REDIS_URL: redisUrl,
      AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_GITHUB_ID: 'e2e', // dummy — no OAuth happens; a minted cookie carries the session
      AUTH_GITHUB_SECRET: 'e2e',
      FALCON_FAKE_LLM: '1',
    },
    stdio: 'pipe',
  });
  server.stdout?.on('data', (d) => process.stdout.write(`[next] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[next] ${d}`));

  await waitForServer(BASE_URL, 120_000);
  // Pre-warm the routes the test hits so next dev's first-request compile doesn't eat the timeout.
  await fetch(`${BASE_URL}/falcon`).catch(() => {});
  await fetch(`${BASE_URL}/api/falcon/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => {});

  return async () => {
    server.kill('SIGTERM');
    await redis.stop().catch(() => {});
    await tdb.stop().catch(() => {});
  };
}
