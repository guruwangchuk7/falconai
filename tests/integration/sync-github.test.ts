// T019 / SC-001/002 (data path): the artifacts a GitHub sync produces must become retrievable with
// provenance and sensible ranking. This exercises the core upsert→index→retrieve path that the
// sync/index jobs drive (the BullMQ queue hop is covered by the worker; wall-clock latency budgets
// are validated by the live quickstart run — CI can't meaningfully time them). Offline embeddings.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DbHandle } from '@falcon/db';
import { indexArtifact, retrieve, upsertArtifact, type CoreDeps } from '@falcon/core';
import type { ArtifactInput } from '@falcon/integrations';
import { startTestDb, type TestDb } from '../support/pg.js';
import { fakeLlm } from '../support/fakeLlm.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';
const REPO = 'acme/web';

// What a GitHub sync delta would yield for one user's recent PRs.
const synced: ArtifactInput[] = [
  { source: 'github', externalRef: 'acme/web#418', type: 'pr', title: 'Rate limiter on the API gateway', body: 'token bucket per tenant on the gateway', repoOrProject: REPO, aclTags: [REPO], trustTier: 'trusted', sourceUpdatedAt: null, ownerExternalId: null },
  { source: 'github', externalRef: 'acme/web#412', type: 'pr', title: 'JWT refresh rotation', body: 'auth session persistence', repoOrProject: REPO, aclTags: [REPO], trustTier: 'trusted', sourceUpdatedAt: null, ownerExternalId: null },
  { source: 'github', externalRef: 'acme/web#399', type: 'pr', title: 'Database migration tooling', body: 'drizzle schema migrations', repoOrProject: REPO, aclTags: [REPO], trustTier: 'trusted', sourceUpdatedAt: null, ownerExternalId: null },
];

let tdb: TestDb;
let db: DbHandle;
let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db, llm: fakeLlm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  for (const input of synced) {
    await db.withTenant(A, async (tx) => {
      const id = await upsertArtifact(tx, A, UA, input);
      await indexArtifact(tx, A, id, deps.llm.embeddings);
    });
  }
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('synced PRs are indexed and retrievable, ranked by relevance, with provenance', async () => {
  const res = await retrieve(deps, { workspaceId: A, requesterUserId: UA, query: 'rate limiting on the api gateway', accessibleTags: [REPO] });
  expect(res.items.length).toBe(synced.length); // all synced artifacts indexed + retrievable
  expect(res.items[0]!.externalRef).toBe('acme/web#418'); // the matching PR ranks first
  for (const item of res.items) expect(item.externalRef.startsWith('acme/web#')).toBe(true);
});

it('re-syncing the same PR is idempotent (no duplicate rows)', async () => {
  await db.withTenant(A, async (tx) => {
    const id = await upsertArtifact(tx, A, UA, synced[0]!);
    await indexArtifact(tx, A, id, deps.llm.embeddings);
  });
  const res = await retrieve(deps, { workspaceId: A, requesterUserId: UA, query: 'rate limiting on the api gateway', accessibleTags: [REPO] });
  expect(res.items.filter((i) => i.externalRef === 'acme/web#418')).toHaveLength(1);
});
