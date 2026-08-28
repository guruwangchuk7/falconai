// T018 / SC-004: retrieve() must return only real, provenance-bearing artifacts inside the
// requester's ACL, and NEVER fabricate. Runs the real ingest + retrieve path against Postgres with
// offline embeddings (no Voyage). Sits on top of the RLS tenant floor proven by isolation.test.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DbHandle } from '@falcon/db';
import { indexArtifact, retrieve, upsertArtifact, type CoreDeps } from '@falcon/core';
import type { ArtifactInput } from '@falcon/integrations';
import { startTestDb, type TestDb } from '../support/pg.js';
import { fakeLlm } from '../support/fakeLlm.js';

const A = '00000000-0000-0000-0000-0000000000aa';
const UA = '00000000-0000-0000-0000-0000000000a1';

let tdb: TestDb;
let db: DbHandle;
let deps: CoreDeps;

const web: ArtifactInput = {
  source: 'github', externalRef: 'acme/web#412', type: 'pr',
  title: 'JWT refresh token rotation',
  body: 'fixes silent logout on authentication token expiry',
  repoOrProject: 'acme/web', aclTags: ['acme/web'], trustTier: 'trusted',
  sourceUpdatedAt: null, ownerExternalId: null,
};
const secret: ArtifactInput = {
  source: 'github', externalRef: 'acme/secret#7', type: 'pr',
  title: 'rotate signing keys', body: 'private repo internal only',
  repoOrProject: 'acme/secret', aclTags: ['acme/secret'], trustTier: 'trusted',
  sourceUpdatedAt: null, ownerExternalId: null,
};

beforeAll(async () => {
  tdb = await startTestDb();
  db = createDb(tdb.appUrl);
  deps = { db, llm: fakeLlm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: UA, email: 'a@x.com' }, 'id', 'email')}`;
  for (const input of [web, secret]) {
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

it('returns only real, provenance-bearing items inside the ACL (SC-004)', async () => {
  const res = await retrieve(deps, { workspaceId: A, requesterUserId: UA, query: 'authentication token', accessibleTags: ['acme/web'] });
  expect(res.items.length).toBeGreaterThan(0);
  for (const item of res.items) {
    expect(item.externalRef).toBeTruthy(); // provenance the caller can cite
    expect(item.externalRef.startsWith('acme/web')).toBe(true); // ACL: the private repo never leaks
  }
  expect(res.items.some((i) => i.externalRef === 'acme/secret#7')).toBe(false);
});

it('never fabricates — a query with no accessible matches returns an empty set', async () => {
  const res = await retrieve(deps, { workspaceId: A, requesterUserId: UA, query: 'anything at all', accessibleTags: ['acme/none'] });
  expect(res.items).toHaveLength(0);
});
