import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { generateDigest, indexArtifact, upsertArtifact, type CoreDeps } from '@falcon/core';
import type { SecretStore } from '@falcon/secrets';
import type { ArtifactInput } from '@falcon/integrations';
import { buildAdapter, type ConnectionRow } from './adapters.js';
import { digestQueue, indexQueue, syncQueue, defaultJobOpts, type DigestJob, type IndexJob, type SyncJob } from './queues.js';

async function memberLoginMap(deps: CoreDeps, workspaceId: string): Promise<Map<string, string>> {
  const rows = await deps.db.rootDb
    .select({ login: schema.users.githubLogin, userId: schema.users.id })
    .from(schema.membership)
    .innerJoin(schema.users, eq(schema.membership.userId, schema.users.id))
    .where(eq(schema.membership.workspaceId, workspaceId));
  const m = new Map<string, string>();
  for (const r of rows) if (r.login) m.set(r.login, r.userId);
  return m;
}

export async function handleSync(deps: CoreDeps, secrets: SecretStore, payload: SyncJob): Promise<void> {
  const { workspaceId, connectionId, delta } = payload;
  const conn = await deps.db.withTenant(workspaceId, async (tx) =>
    (await tx.select().from(schema.connection).where(eq(schema.connection.id, connectionId)).limit(1))[0],
  );
  if (!conn) return;
  const connRow: ConnectionRow = {
    id: conn.id, provider: conn.provider as ConnectionRow['provider'], userId: conn.userId,
    externalAccountRef: conn.externalAccountRef, secretRef: conn.secretRef,
  };
  const members = await memberLoginMap(deps, workspaceId);

  try {
    let items: ArtifactInput[];
    if (delta) {
      items = delta;
    } else {
      const adapter = await buildAdapter(connRow, secrets, new Set(members.keys()));
      const since = (conn.syncCursor as { since?: string } | null)?.since;
      items = [];
      for await (const it of adapter.listChanged(since ? { since } : {})) items.push(it);
    }

    let count = 0;
    for (const it of items) {
      const userId = (it.ownerExternalId && members.get(it.ownerExternalId)) || conn.userId;
      const artifactId = await deps.db.withTenant(workspaceId, (tx) => upsertArtifact(tx, workspaceId, userId, it));
      await indexQueue.add('index', { workspaceId, artifactId }, defaultJobOpts);
      count++;
    }

    await deps.db.withTenant(workspaceId, async (tx) => {
      await tx.update(schema.connection)
        .set({ status: 'active', lastSyncedAt: new Date(), lastError: null, syncCursor: { since: new Date().toISOString() } })
        .where(eq(schema.connection.id, connectionId));
      await tx.insert(schema.syncRun).values({ workspaceId, connectionId, finishedAt: new Date(), status: 'ok', artifactsSynced: count });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.db.withTenant(workspaceId, async (tx) => {
      await tx.update(schema.connection).set({ status: 'error', lastError: msg }).where(eq(schema.connection.id, connectionId));
      await tx.insert(schema.syncRun).values({ workspaceId, connectionId, finishedAt: new Date(), status: 'failed', error: msg, artifactsSynced: 0 });
    });
    throw err; // BullMQ retries with backoff
  }
}

export async function handleIndex(deps: CoreDeps, payload: IndexJob): Promise<void> {
  await deps.db.withTenant(payload.workspaceId, (tx) => indexArtifact(tx, payload.workspaceId, payload.artifactId, deps.llm.embeddings));
}

export async function handleDigest(deps: CoreDeps, payload: DigestJob): Promise<void> {
  await generateDigest(deps, payload.workspaceId, payload.userId);
}

/** Poll scheduler: iterate workspaces (not RLS'd) and enqueue a sync per active connection. */
export async function pollAll(deps: CoreDeps): Promise<void> {
  const workspaces = await deps.db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace);
  for (const ws of workspaces) {
    const conns = await deps.db.withTenant(ws.id, (tx) =>
      tx.select({ id: schema.connection.id }).from(schema.connection).where(eq(schema.connection.status, 'active')),
    );
    for (const c of conns) await syncQueue.add('sync', { workspaceId: ws.id, connectionId: c.id }, defaultJobOpts);
  }
}

/** Nightly: enqueue a digest job per (workspace, member). */
export async function pollDigests(deps: CoreDeps): Promise<void> {
  const rows = await deps.db.rootDb
    .select({ workspaceId: schema.membership.workspaceId, userId: schema.membership.userId })
    .from(schema.membership);
  for (const r of rows) await digestQueue.add('digest', { workspaceId: r.workspaceId, userId: r.userId }, defaultJobOpts);
}
