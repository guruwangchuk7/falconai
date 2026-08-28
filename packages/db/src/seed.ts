import { and, eq } from 'drizzle-orm';
import { createDb, schema } from './index.js';

/**
 * Dev seed (T040 + quickstart). Creates a test workspace, two users, memberships, one GitHub
 * connection, a shared + a private repo's worth of artifacts (so ACL scoping is demonstrable), and
 * a few decision records across the lifecycle (confirmed / superseded) for the Decision Index.
 *
 * Idempotent: safe to re-run (find-or-create by natural keys). Tenant tables are written through
 * withTenant so RLS is exercised, not bypassed. Decisions are embedded via Voyage when
 * VOYAGE_API_KEY is set (so decision search returns them); otherwise inserted without embeddings.
 *
 * Run: `pnpm --filter @falcon/db seed` (needs DATABASE_URL; VOYAGE_API_KEY optional).
 */

const WS_NAME = 'Acme (seed)';
const SHARED = 'acme/web';
const PRIVATE = 'acme/secret';

async function embed(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return texts.map(() => null);
  const r = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: 'voyage-code-4', input_type: 'document' }),
  });
  if (!r.ok) {
    console.warn(`voyage embed failed (${r.status}); seeding decisions without embeddings.`);
    return texts.map(() => null);
  }
  const j = (await r.json()) as { data: Array<{ embedding: number[] }> };
  return j.data.map((d) => d.embedding);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to seed.');
    process.exit(1);
    return;
  }
  const db = createDb(url);

  // --- workspace (find-or-create by name; no natural key) ---
  const wsExisting = await db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace).where(eq(schema.workspace.name, WS_NAME)).limit(1);
  const workspaceId = wsExisting[0]?.id
    ?? (await db.rootDb.insert(schema.workspace).values({ name: WS_NAME, settings: {} }).returning({ id: schema.workspace.id }))[0]!.id;

  // --- users + memberships (idempotent on unique email / (user,workspace)) ---
  async function upsertUser(email: string, name: string, githubLogin: string): Promise<string> {
    await db.rootDb.insert(schema.users).values({ email, name, githubLogin }).onConflictDoNothing({ target: schema.users.email });
    const r = await db.rootDb.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return r[0]!.id;
  }
  const aliceId = await upsertUser('alice@acme.test', 'Alice (PM)', 'alice');
  const bobId = await upsertUser('bob@acme.test', 'Bob (Eng)', 'bob');
  for (const userId of [aliceId, bobId]) {
    await db.rootDb.insert(schema.membership).values({ userId, workspaceId, role: 'engineer' }).onConflictDoNothing();
  }

  await db.withTenant(workspaceId, async (tx) => {
    // --- a GitHub connection so /integrations isn't empty ---
    const connExists = await tx.select({ id: schema.connection.id }).from(schema.connection)
      .where(and(eq(schema.connection.provider, 'github'), eq(schema.connection.externalAccountRef, 'seed-install'))).limit(1);
    if (!connExists[0]) {
      await tx.insert(schema.connection).values({
        workspaceId, userId: aliceId, provider: 'github', status: 'active',
        externalAccountRef: 'seed-install', lastSyncedAt: new Date(),
      });
    }

    // --- artifacts: shared repo (alice) + private repo (bob) — demonstrates ACL scoping ---
    const artifacts = [
      { userId: aliceId, source: 'github', externalRef: 'acme/web#412', type: 'pull_request', title: 'Add JWT refresh-token rotation', body: 'Fixes silent logout on token expiry.', repoOrProject: SHARED, aclTags: [SHARED] },
      { userId: aliceId, source: 'github', externalRef: 'acme/web#418', type: 'pull_request', title: 'Rate limiter on the API gateway', body: 'Token-bucket, per-tenant.', repoOrProject: SHARED, aclTags: [SHARED] },
      { userId: bobId, source: 'github', externalRef: 'acme/secret#7', type: 'pull_request', title: 'Rotate signing keys', body: 'Private repo — should not surface to non-members.', repoOrProject: PRIVATE, aclTags: [PRIVATE] },
    ];
    for (const a of artifacts) {
      await tx.insert(schema.artifact).values({
        workspaceId, userId: a.userId, source: a.source, externalRef: a.externalRef, type: a.type,
        title: a.title, body: a.body, repoOrProject: a.repoOrProject, aclTags: a.aclTags,
        trustTier: 'trusted', lastSyncedAt: new Date(), isStale: false,
      }).onConflictDoNothing({ target: [schema.artifact.workspaceId, schema.artifact.source, schema.artifact.externalRef] });
    }

    // --- decision records across the lifecycle (T040) ---
    const decisions = [
      { title: 'Tenant isolation via Postgres RLS', decision: 'Enforce RLS keyed on workspace_id, non-superuser role, FORCE RLS.', rationale: 'Blocker-class isolation; partitioning alone is not a security boundary.', status: 'confirmed', supersedesId: null as string | null },
      { title: 'Embeddings: voyage-code-4 (1024-dim)', decision: 'Use voyage-code-4; store embedding_model + version per row.', rationale: 'Code-tuned; recall@k bake-off pending to confirm vs voyage-4-large.', status: 'confirmed', supersedesId: null },
      { title: 'Use OpenAI ada-002 for embeddings', decision: 'Superseded by voyage-code-4.', rationale: 'Original choice before the code-embedding evaluation.', status: 'superseded', supersedesId: null },
    ];
    const vecs = await embed(decisions.map((d) => `${d.title}\n${d.decision}`));
    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i]!;
      const exists = await tx.select({ id: schema.decisionRecord.id }).from(schema.decisionRecord).where(eq(schema.decisionRecord.title, d.title)).limit(1);
      if (exists[0]) continue;
      const v = vecs[i];
      await tx.insert(schema.decisionRecord).values({
        workspaceId, title: d.title, decision: d.decision, rationale: d.rationale, status: d.status,
        ownerUserId: aliceId, confirmedBy: d.status === 'confirmed' ? aliceId : null,
        confirmedAt: d.status === 'confirmed' ? new Date() : null,
        ...(v ? { embedding: v, embeddingModel: 'voyage-code-4', embeddingVersion: 'voyage-code-4' } : {}),
      });
    }
  });

  const embedded = process.env.VOYAGE_API_KEY ? 'with embeddings' : 'WITHOUT embeddings (set VOYAGE_API_KEY to make decisions searchable)';
  console.log(`Seeded workspace "${WS_NAME}" (${workspaceId}): 2 users, 1 connection, 3 artifacts, 3 decisions ${embedded}.`);
  await db.client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
