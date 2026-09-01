import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION } from '@falcon/llm';
import { DECISION_RELEVANCE_MAX_DISTANCE } from '@falcon/config';
import type { CoreDeps } from './deps.js';
import type { UnconfirmedMatch } from './decision-status.js';

export interface DecisionResult {
  id: string;
  title: string;
  decision: string | null;
  supersedesId: string | null;
  createdAt: string;
  freshnessFlag: boolean; // older than the workspace horizon
  score: number;
}

/** Input for capturing a decision (F10.1). Stored as `unconfirmed`; embedded at CREATE (R2) so it is
 *  matchable while remaining non-grounding until confirmed. */
export interface CreateDecisionInput {
  title: string;
  decision?: string;
  rationale?: string;
  options?: unknown;
  dissent?: string;
  ownerUserId?: string;
  sourceRef?: string;
  origin?: 'manual' | 'suggested';
}

/** A row in the unconfirmed queue (content IS shown here — this is the human confirm surface, not an
 *  answer; the content boundary applies to answers, per data-model.md §4). */
export interface QueueItem {
  id: string;
  title: string;
  decision: string | null;
  rationale: string | null;
  options: unknown;
  sourceRef: string | null;
  createdAt: string;
}

/** Embed the text used for decision retrieval — title + decision (falls back to title). Pinned model. */
async function embedDecision(deps: CoreDeps, title: string, decision?: string | null): Promise<number[]> {
  const text = [title, decision ?? ''].filter(Boolean).join('\n');
  const [vec] = await deps.llm.embeddings.embed([text], 'document');
  return vec!;
}

/**
 * Create a decision record (F10.1, US1). Inserts `status='unconfirmed'` and embeds immediately (R2):
 * the embedding makes the record *matchable* for status surfacing, but `status='confirmed'` remains
 * the sole grounding gate — an unconfirmed record never grounds an answer. Tenant-scoped (RLS).
 */
export async function createDecision(
  deps: CoreDeps,
  workspaceId: string,
  input: CreateDecisionInput,
): Promise<{ id: string }> {
  const embedding = await embedDecision(deps, input.title, input.decision);
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx
      .insert(schema.decisionRecord)
      .values({
        workspaceId,
        title: input.title,
        decision: input.decision ?? null,
        rationale: input.rationale ?? null,
        options: input.options ?? null,
        dissent: input.dissent ?? null,
        ownerUserId: input.ownerUserId ?? null,
        sourceRef: input.sourceRef ?? null,
        status: 'unconfirmed',
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
      })
      .returning({ id: schema.decisionRecord.id });
    return { id: row!.id };
  });
}

/**
 * Confirm a decision (F10.1/F10.4, US1) — the human-in-the-loop write gate that feeds the read path.
 * unconfirmed → confirmed, stamping the confirmer + time. Idempotent: already-confirmed or superseded
 * records are a no-op (state never regresses). Only after this does the record become retrievable.
 */
export async function confirmDecision(
  deps: CoreDeps,
  workspaceId: string,
  id: string,
  confirmedBy: string,
): Promise<{ status: 'confirmed' | 'noop' }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const res = await tx
      .update(schema.decisionRecord)
      .set({ status: 'confirmed', confirmedBy, confirmedAt: new Date() })
      .where(and(eq(schema.decisionRecord.id, id), eq(schema.decisionRecord.status, 'unconfirmed'), isNull(schema.decisionRecord.dismissedAt)))
      .returning({ id: schema.decisionRecord.id });
    return { status: res.length > 0 ? 'confirmed' : 'noop' };
  });
}

/**
 * Supersede a confirmed decision with a newer confirmed one (US3, F10.1/R23). Links the new record to
 * the old via `supersedes_id` and flips the old record to `superseded` so it stops surfacing as live —
 * a reversed decision is never presented as current. The new record MUST be confirmed. Idempotent: an
 * already-superseded old record is a no-op. Self-supersede is refused.
 */
export async function supersedeDecision(
  deps: CoreDeps,
  workspaceId: string,
  args: { newRecordId: string; supersedesId: string },
): Promise<{ superseded: boolean }> {
  if (args.newRecordId === args.supersedesId) return { superseded: false };
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [nw] = await tx
      .select({ status: schema.decisionRecord.status })
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.id, args.newRecordId))
      .limit(1);
    if (!nw || nw.status !== 'confirmed') return { superseded: false }; // only a confirmed record can supersede
    await tx
      .update(schema.decisionRecord)
      .set({ supersedesId: args.supersedesId })
      .where(eq(schema.decisionRecord.id, args.newRecordId));
    const res = await tx
      .update(schema.decisionRecord)
      .set({ status: 'superseded' })
      .where(and(eq(schema.decisionRecord.id, args.supersedesId), eq(schema.decisionRecord.status, 'confirmed')))
      .returning({ id: schema.decisionRecord.id });
    return { superseded: res.length > 0 };
  });
}

/**
 * Dismiss an unconfirmed candidate (US4). Sets `dismissed_at` (a tombstone, orthogonal to `status`) so
 * it never grounds, never surfaces as answer status metadata, and (Ship 2) is never re-suggested for
 * the same source. Only an un-dismissed `unconfirmed` row can be dismissed; confirmed/superseded are
 * refused. Idempotent.
 */
export async function dismissDecision(deps: CoreDeps, workspaceId: string, id: string): Promise<{ dismissed: boolean }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const res = await tx
      .update(schema.decisionRecord)
      .set({ dismissedAt: new Date() })
      .where(and(eq(schema.decisionRecord.id, id), eq(schema.decisionRecord.status, 'unconfirmed'), isNull(schema.decisionRecord.dismissedAt)))
      .returning({ id: schema.decisionRecord.id });
    return { dismissed: res.length > 0 };
  });
}

/** List the unconfirmed queue (US1) — awaiting human ratification, excluding dismissed. Newest first. */
export async function listQueue(deps: CoreDeps, workspaceId: string): Promise<QueueItem[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        title: schema.decisionRecord.title,
        decision: schema.decisionRecord.decision,
        rationale: schema.decisionRecord.rationale,
        options: schema.decisionRecord.options,
        sourceRef: schema.decisionRecord.sourceRef,
        createdAt: schema.decisionRecord.createdAt,
      })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.status, 'unconfirmed'), isNull(schema.decisionRecord.dismissedAt)))
      .orderBy(desc(schema.decisionRecord.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

/** Full decision record for the detail view / citation target (US1). Includes the title of the
 *  record this one supersedes, when any (the supersede chain is completed in US3). */
export interface DecisionDetail {
  id: string;
  title: string;
  decision: string | null;
  rationale: string | null;
  dissent: string | null;
  options: unknown;
  ownerUserId: string | null;
  status: string;
  sourceRef: string | null;
  supersedesId: string | null;
  supersedesTitle: string | null;
  supersededById: string | null; // the record that superseded THIS one (chain, other direction)
  supersededByTitle: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  freshnessFlag: boolean;
}

export async function getDecision(
  deps: CoreDeps,
  workspaceId: string,
  id: string,
  horizonDays = 180,
): Promise<DecisionDetail | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select().from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1);
    if (!r) return null;
    let supersedesTitle: string | null = null;
    if (r.supersedesId) {
      const [old] = await tx
        .select({ title: schema.decisionRecord.title })
        .from(schema.decisionRecord)
        .where(eq(schema.decisionRecord.id, r.supersedesId))
        .limit(1);
      supersedesTitle = old?.title ?? null;
    }
    // The record that superseded THIS one, if any (chain, forward direction).
    const [successor] = await tx
      .select({ id: schema.decisionRecord.id, title: schema.decisionRecord.title })
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.supersedesId, r.id))
      .limit(1);
    const horizon = Date.now() - horizonDays * 86_400_000;
    return {
      id: r.id,
      title: r.title,
      decision: r.decision,
      rationale: r.rationale,
      dissent: r.dissent,
      options: r.options,
      ownerUserId: r.ownerUserId,
      status: r.status,
      sourceRef: r.sourceRef,
      supersedesId: r.supersedesId,
      supersedesTitle,
      supersededById: successor?.id ?? null,
      supersededByTitle: successor?.title ?? null,
      confirmedBy: r.confirmedBy,
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      freshnessFlag: r.createdAt.getTime() < horizon,
    };
  });
}

/**
 * Match UNCONFIRMED candidates to a question (US2, FR-008) — returns METADATA ONLY:
 * `{ id, sourceRef, createdAt, distance }`. It deliberately does NOT select decision/rationale/
 * options/title, so unconfirmed content cannot leak into an answer or a prompt (the boundary is
 * enforced at the query, not by trust). Filters `status='unconfirmed' AND dismissed_at IS NULL` and
 * keeps only matches within the relevance ceiling (research.md R1). `queryVec` (R7) shares one embed.
 */
export async function matchUnconfirmedCandidates(
  deps: CoreDeps,
  workspaceId: string,
  query: string,
  k = 4,
  queryVec?: number[],
): Promise<UnconfirmedMatch[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const qvec = queryVec ?? (await deps.llm.embeddings.embed([query], 'query'))[0];
    const vecStr = `[${qvec!.join(',')}]`;
    const dist = sql<number>`${schema.decisionRecord.embedding} <=> ${vecStr}::vector`;
    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        sourceRef: schema.decisionRecord.sourceRef,
        createdAt: schema.decisionRecord.createdAt,
        distance: dist,
      })
      .from(schema.decisionRecord)
      .where(
        and(
          eq(schema.decisionRecord.status, 'unconfirmed'),
          isNull(schema.decisionRecord.dismissedAt),
          sql`${schema.decisionRecord.embedding} is not null`,
        ),
      )
      .orderBy(dist)
      .limit(k);
    return rows
      .map((r) => ({ id: r.id, sourceRef: r.sourceRef, createdAt: r.createdAt.toISOString(), distance: Number(r.distance) }))
      .filter((m) => m.distance <= DECISION_RELEVANCE_MAX_DISTANCE);
  });
}

/** F2.4 / F10.1 — Org Decision Index search. ONLY confirmed records are retrievable (FR-012);
 *  superseded is excluded; results past the freshness horizon are flagged. `queryVec` (R7) lets the
 *  caller share one query embedding across retrieval paths. */
export async function searchDecisions(
  deps: CoreDeps,
  workspaceId: string,
  query: string,
  k = 10,
  horizonDays = 180,
  queryVec?: number[],
): Promise<DecisionResult[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const qvec = queryVec ?? (await deps.llm.embeddings.embed([query], 'query'))[0];
    const vecStr = `[${qvec!.join(',')}]`;
    const dist = sql<number>`${schema.decisionRecord.embedding} <=> ${vecStr}::vector`;

    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        title: schema.decisionRecord.title,
        decision: schema.decisionRecord.decision,
        supersedesId: schema.decisionRecord.supersedesId,
        createdAt: schema.decisionRecord.createdAt,
        score: dist,
      })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.status, 'confirmed'), sql`${schema.decisionRecord.embedding} is not null`))
      .orderBy(dist)
      .limit(k);

    const horizon = Date.now() - horizonDays * 86_400_000;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      decision: r.decision,
      supersedesId: r.supersedesId,
      createdAt: r.createdAt.toISOString(),
      freshnessFlag: r.createdAt.getTime() < horizon,
      score: Number(r.score),
    }));
  });
}
