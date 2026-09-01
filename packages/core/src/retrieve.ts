import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { schema, type TenantTx } from '@falcon/db';
import { EMBEDDING_MODEL } from '@falcon/llm';
import type { CoreDeps } from './deps.js';

export interface RetrieveInput {
  workspaceId: string;
  requesterUserId: string;
  query: string;
  k?: number;
  sources?: ('github' | 'linear' | 'jira')[];
  /** Override the requester's accessible repo/project tags (else derived from their artifacts). */
  accessibleTags?: string[];
  /** Optional time window on the artifact's source-updated time (ISO). Lets "today / this week /
   *  last month" actually constrain results by date, not just semantics. */
  since?: string;
  until?: string;
  /** Precomputed query embedding (feature 005 R7). When provided, retrieval reuses it instead of
   *  embedding again — lets the caller embed the query ONCE and share it across retrieve /
   *  searchDecisions / matchUnconfirmedCandidates (Voyage RPM). Must be the pinned model's vector. */
  queryVec?: number[];
}

export interface RetrievedItem {
  artifactId: string;
  type: string;
  externalRef: string; // provenance the caller can cite
  title: string | null;
  source: string; // github | linear | jira — used to build an openable citation URL
  repoOrProject: string | null; // e.g. "owner/repo" — the other half of the URL
  snippet: string;
  score: number;
  trustTier: 'trusted' | 'mixed' | 'untrusted';
  lastSyncedAt: string;
  isStale: boolean;
}

export interface RetrieveResult {
  items: RetrievedItem[];
  degraded?: { reason: 'sync_stale' | 'source_disconnected'; sources: string[] };
}

/** Phase-1 ACL policy: a requester can access the repos/projects they have artifacts in.
 *  (Finer per-repo collaborator sync is later; RLS tenant isolation is enforced regardless.) */
async function accessibleTagsFor(tx: TenantTx, requesterUserId: string): Promise<string[]> {
  const rows = (await tx.execute(
    sql`select distinct jsonb_array_elements_text(acl_tags) as tag from artifact where user_id = ${requesterUserId}`,
  )) as unknown as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

/**
 * The load-bearing retrieval contract (constitution II, FR-007/012/017). Tenant-scoped via
 * withTenant (RLS + partition prune), ACL-filtered on acl_tags, provenance-bearing, embedding-
 * space filtered. Never fabricates; returns only real, access-checked artifacts.
 */
export async function retrieve(deps: CoreDeps, input: RetrieveInput): Promise<RetrieveResult> {
  const k = input.k ?? 8;
  return deps.db.withTenant(input.workspaceId, async (tx) => {
    const accessible = input.accessibleTags ?? (await accessibleTagsFor(tx, input.requesterUserId));
    if (accessible.length === 0) return { items: [] };

    const qvec = input.queryVec ?? (await deps.llm.embeddings.embed([input.query], 'query'))[0];
    const vecStr = `[${qvec!.join(',')}]`;
    const dist = sql<number>`${schema.artifactChunk.embedding} <=> ${vecStr}::vector`;

    // ACL: artifact is visible if any of its acl_tags is in the requester's accessible set.
    // Use jsonb @> containment (proven in acl.test) OR'd per tag — avoids a raw text[] param cast.
    const aclCond = or(...accessible.map((tag) => sql`${schema.artifact.aclTags} @> ${JSON.stringify([tag])}::jsonb`));
    const conds = [eq(schema.artifactChunk.embeddingModel, EMBEDDING_MODEL)];
    if (aclCond) conds.push(aclCond);
    if (input.sources && input.sources.length > 0) {
      conds.push(inArray(schema.artifact.source, input.sources));
    }
    // Date window: constrain by the artifact's source-updated time (rows with a null timestamp
    // are excluded when a window is set — an undated artifact can't satisfy "today").
    if (input.since) conds.push(gte(schema.artifact.sourceUpdatedAt, new Date(input.since)));
    if (input.until) conds.push(lt(schema.artifact.sourceUpdatedAt, new Date(input.until)));

    const rows = await tx
      .select({
        artifactId: schema.artifact.id,
        type: schema.artifact.type,
        externalRef: schema.artifact.externalRef,
        title: schema.artifact.title,
        source: schema.artifact.source,
        repoOrProject: schema.artifact.repoOrProject,
        snippet: schema.artifactChunk.content,
        trustTier: schema.artifactChunk.trustTier,
        lastSyncedAt: schema.artifact.lastSyncedAt,
        isStale: schema.artifact.isStale,
        score: dist,
      })
      .from(schema.artifactChunk)
      .innerJoin(
        schema.artifact,
        and(eq(schema.artifactChunk.artifactId, schema.artifact.id), eq(schema.artifactChunk.workspaceId, schema.artifact.workspaceId)),
      )
      .where(and(...conds))
      .orderBy(dist)
      .limit(k);

    // Honest degradation: flag stale/disconnected sources so the caller doesn't read a thin
    // result set as complete (FR-013).
    const stale = await tx
      .select({ provider: schema.connection.provider, status: schema.connection.status })
      .from(schema.connection);
    const badSources = stale.filter((c) => c.status !== 'active').map((c) => c.provider);

    const result: RetrieveResult = {
      items: rows.map((r) => ({
        artifactId: r.artifactId,
        type: r.type,
        externalRef: r.externalRef,
        title: r.title,
        source: r.source,
        repoOrProject: r.repoOrProject,
        snippet: r.snippet,
        score: Number(r.score),
        trustTier: r.trustTier as RetrievedItem['trustTier'],
        lastSyncedAt: r.lastSyncedAt.toISOString(),
        isStale: r.isStale,
      })),
    };
    if (badSources.length > 0) result.degraded = { reason: 'source_disconnected', sources: badSources };
    return result;
  });
}
