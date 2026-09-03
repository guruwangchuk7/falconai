import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type TenantTx } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION } from '@falcon/llm';
import { DECISION_RELEVANCE_MAX_DISTANCE } from '@falcon/config';
import type { CoreDeps } from './deps.js';
import type { UnconfirmedMatch } from './decision-status.js';
import type { Attendee } from './meeting.js';

export interface DecisionResult {
  id: string;
  title: string;
  decision: string | null;
  supersedesId: string | null;
  createdAt: string;
  freshnessFlag: boolean; // older than the workspace horizon
  score: number;
}

/** A resolved evidence span attached to a meeting-sourced decision (D4). Structurally matches C2's
 *  `ResolvedSpan` — text, not indices, so it survives independent of the (short-lived) transcript. */
export interface DecisionSpanInput {
  kind: 'decision' | 'rationale';
  utteranceIdx: number;
  speaker: string | null;
  tsMs: number;
  text: string;
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
  origin?: 'manual' | 'suggested' | 'meeting';
  visibility?: 'workspace' | 'attendees_only'; // D13 — defaults to 'workspace'
  participants?: Attendee[];                    // D12 — attendee snapshot
  spans?: DecisionSpanInput[];                  // D4 — resolved evidence (meeting-sourced)
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
  origin: string;
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
        origin: input.origin ?? 'manual',
        status: 'unconfirmed',
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
        visibility: input.visibility ?? 'workspace',
        participants: input.participants ?? null,
      })
      .returning({ id: schema.decisionRecord.id });
    if (input.spans && input.spans.length > 0) {
      await tx.insert(schema.decisionSpan).values(
        input.spans.map((s) => ({
          workspaceId, decisionId: row!.id, kind: s.kind,
          speaker: s.speaker, tsMs: s.tsMs, utteranceIdx: s.utteranceIdx, text: s.text,
        })),
      );
    }
    return { id: row!.id };
  });
}

/**
 * Confirm a decision (F10.1/F10.4, US1) — the human-in-the-loop write gate that feeds the read path.
 * unconfirmed → confirmed, stamping the confirmer + time. A record MUST have non-empty `decision` text
 * to be confirmed (review finding #3): confirming turns it into retrievable evidence, so a title-only
 * record would ground answers on nothing — returns `missing_decision` instead. Idempotent: already-
 * confirmed/superseded/dismissed records are a no-op (state never regresses).
 */
export async function confirmDecision(
  deps: CoreDeps,
  workspaceId: string,
  id: string,
  confirmedBy: string,
  ownerUserId?: string,
  visibility?: 'workspace' | 'attendees_only',
): Promise<{ status: 'confirmed' | 'not_found' | 'already_final' | 'missing_decision' | 'visibility_required' }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx
      .select({ status: schema.decisionRecord.status, decision: schema.decisionRecord.decision, dismissedAt: schema.decisionRecord.dismissedAt, origin: schema.decisionRecord.origin })
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.id, id))
      .limit(1);
    if (!row) return { status: 'not_found' }; // absent, or another tenant's record (RLS hides it)
    if (row.dismissedAt || row.status !== 'unconfirmed') return { status: 'already_final' }; // confirmed/superseded/dismissed
    if (!row.decision || row.decision.trim() === '') return { status: 'missing_decision' };
    // D13 (refined): a MEETING decision must carry an EXPLICIT visibility choice at confirm — the write
    // gate refuses a silent default so a client-confidential decision can never be filed workspace-wide
    // just because a reviewer didn't pick. Predicate on the typed `origin` column, NOT a sourceRef
    // string-prefix: a security gate must not hinge on a free-text convention that can silently drift.
    if (row.origin === 'meeting' && !visibility) return { status: 'visibility_required' };
    await tx
      .update(schema.decisionRecord)
      .set({
        status: 'confirmed',
        confirmedBy,
        confirmedAt: new Date(),
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(visibility ? { visibility } : {}),
      })
      .where(and(eq(schema.decisionRecord.id, id), eq(schema.decisionRecord.status, 'unconfirmed')));
    return { status: 'confirmed' };
  });
}

/**
 * Widen a confirmed record's visibility tier (D13). ONLY attendees_only -> workspace is permitted:
 * the tier governs the human-authored summary, so widening is an ordinary editorial act, but narrowing
 * after non-attendees may have read it is theater — and is impossible here by construction (there is no
 * API that sets attendees_only on a confirmed record; the tier is chosen once at confirm). Idempotent.
 */
export async function setVisibility(deps: CoreDeps, workspaceId: string, id: string): Promise<{ status: 'widened' | 'already_workspace' | 'not_found' }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({ visibility: schema.decisionRecord.visibility })
      .from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1);
    if (!r) return { status: 'not_found' };
    if (r.visibility === 'workspace') return { status: 'already_workspace' }; // one-way: never narrows
    await tx.update(schema.decisionRecord).set({ visibility: 'workspace' }).where(eq(schema.decisionRecord.id, id));
    return { status: 'widened' };
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
  // Read the attendee snapshot first: deleting the (attendee-gated) decision_span rows requires an
  // attendee viewer context, because 0008's RESTRICTIVE SELECT policy also governs a DELETE's WHERE.
  const participants = await deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({ participants: schema.decisionRecord.participants })
      .from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1);
    return r?.participants;
  });
  const attendeeId = Array.isArray(participants) ? (participants[0] as { userId?: string })?.userId : undefined;

  const run = async (tx: TenantTx) => {
    const res = await tx
      .update(schema.decisionRecord)
      .set({ dismissedAt: new Date() })
      .where(and(eq(schema.decisionRecord.id, id), eq(schema.decisionRecord.status, 'unconfirmed'), isNull(schema.decisionRecord.dismissedAt)))
      .returning({ id: schema.decisionRecord.id });
    if (res.length > 0) {
      // D5: dismissing deletes the verbatim spans — tombstone keeps only the normalized title.
      await tx.delete(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, id));
    }
    return { dismissed: res.length > 0 };
  };

  // If the record has attendees (meeting-sourced), run under an attendee viewer so the span DELETE
  // passes the 0008 gate; otherwise a plain tenant context (no spans exist to delete).
  return attendeeId
    ? deps.db.withViewer(workspaceId, attendeeId, run)
    : deps.db.withTenant(workspaceId, run);
}

/** List the unconfirmed queue (US1) — awaiting human ratification, excluding dismissed. Newest first,
 *  bounded (review finding #5) so a large backlog can't load unboundedly. */
export async function listQueue(deps: CoreDeps, workspaceId: string, limit = 100, sourceRef?: string): Promise<QueueItem[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        title: schema.decisionRecord.title,
        decision: schema.decisionRecord.decision,
        rationale: schema.decisionRecord.rationale,
        options: schema.decisionRecord.options,
        sourceRef: schema.decisionRecord.sourceRef,
        origin: schema.decisionRecord.origin,
        createdAt: schema.decisionRecord.createdAt,
      })
      .from(schema.decisionRecord)
      .where(and(
        eq(schema.decisionRecord.status, 'unconfirmed'),
        isNull(schema.decisionRecord.dismissedAt),
        sourceRef ? eq(schema.decisionRecord.sourceRef, sourceRef) : undefined,
      ))
      .orderBy(desc(schema.decisionRecord.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

/** A confirmed decision as shown in the browsable Decision Memory list. */
export interface ConfirmedItem {
  id: string;
  title: string;
  decision: string | null;
  sourceRef: string | null;
  origin: string;
  confirmedAt: string | null;
}

/**
 * Browse the org's confirmed Decision Memory (the read side of the confirm gate, F10.1). Confirmed
 * only — never unconfirmed (not yet ratified) or superseded (replaced). Applies the SAME visibility
 * tier as searchDecisions: `attendees_only` records surface only to a viewer in the participants
 * snapshot (D13); without a viewer, only `workspace`-tier records. Newest confirmations first.
 */
export async function listConfirmed(deps: CoreDeps, workspaceId: string, limit = 100, viewerUserId?: string): Promise<ConfirmedItem[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const tier = viewerUserId
      ? sql`(${schema.decisionRecord.visibility} = 'workspace' or exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(${schema.decisionRecord.participants}, '[]'::jsonb)) = 'array' then ${schema.decisionRecord.participants} else '[]'::jsonb end) p
            where p->>'userId' = ${viewerUserId}))`
      : sql`${schema.decisionRecord.visibility} = 'workspace'`;
    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        title: schema.decisionRecord.title,
        decision: schema.decisionRecord.decision,
        sourceRef: schema.decisionRecord.sourceRef,
        origin: schema.decisionRecord.origin,
        confirmedAt: schema.decisionRecord.confirmedAt,
      })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.status, 'confirmed'), tier))
      .orderBy(desc(schema.decisionRecord.confirmedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null }));
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
  origin: string;
  sourceRef: string | null;
  supersedesId: string | null;
  supersedesTitle: string | null;
  supersedesRestricted: boolean;   // the record THIS supersedes is attendees_only & inaccessible (D15)
  supersededById: string | null; // the record that superseded THIS one (chain, other direction)
  supersededByTitle: string | null;
  supersededByRestricted: boolean; // the record that superseded THIS one is attendees_only & inaccessible (D15)
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
  viewerUserId?: string,
  horizonDays = 180,
): Promise<DecisionDetail | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select().from(schema.decisionRecord).where(eq(schema.decisionRecord.id, id)).limit(1);
    if (!r) return null;
    // D13 tier gate: an attendees_only record is invisible to anyone outside its participants
    // snapshot (SUMMARY tier), even within the same workspace/tenant.
    if (r.visibility === 'attendees_only') {
      const isAttendee = !!viewerUserId && Array.isArray(r.participants) &&
        (r.participants as { userId?: string }[]).some((p) => p?.userId === viewerUserId);
      if (!isAttendee) return null;
    }
    // D15: an accessible chain neighbor's title may itself be attendees_only and inaccessible to this
    // viewer — the chain link must project as a restricted FACT, never leak the neighbor's title.
    const canSee = (visibility: string | null, participants: unknown): boolean =>
      visibility !== 'attendees_only' ||
      (!!viewerUserId && Array.isArray(participants) && (participants as { userId?: string }[]).some((p) => p?.userId === viewerUserId));

    let supersedesTitle: string | null = null;
    let supersedesRestricted = false;
    if (r.supersedesId) {
      const [old] = await tx
        .select({ title: schema.decisionRecord.title, visibility: schema.decisionRecord.visibility, participants: schema.decisionRecord.participants })
        .from(schema.decisionRecord)
        .where(eq(schema.decisionRecord.id, r.supersedesId))
        .limit(1);
      if (old) {
        if (canSee(old.visibility, old.participants)) supersedesTitle = old.title;
        else supersedesRestricted = true;
      }
    }
    // The record that superseded THIS one, if any (chain, forward direction).
    const [successor] = await tx
      .select({ id: schema.decisionRecord.id, title: schema.decisionRecord.title, visibility: schema.decisionRecord.visibility, participants: schema.decisionRecord.participants })
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.supersedesId, r.id))
      .limit(1);
    let supersededById: string | null = null;
    let supersededByTitle: string | null = null;
    let supersededByRestricted = false;
    if (successor) {
      if (canSee(successor.visibility, successor.participants)) { supersededById = successor.id; supersededByTitle = successor.title; }
      else supersededByRestricted = true;
    }
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
      origin: r.origin,
      sourceRef: r.sourceRef,
      supersedesId: r.supersedesId,
      supersedesTitle,
      supersedesRestricted,
      supersededById,
      supersededByTitle,
      supersededByRestricted,
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
 *  caller share one query embedding across retrieval paths. `viewerUserId` (D13 tier gate) excludes
 *  `attendees_only` records the viewer isn't a participant of; with no viewer, ALL `attendees_only`
 *  records are excluded (workspace-tier only) — existing callers that pass no viewer keep their
 *  current (workspace-tier) behavior unchanged. */
export async function searchDecisions(
  deps: CoreDeps,
  workspaceId: string,
  query: string,
  k = 10,
  horizonDays = 180,
  queryVec?: number[],
  viewerUserId?: string,
): Promise<DecisionResult[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const qvec = queryVec ?? (await deps.llm.embeddings.embed([query], 'query'))[0];
    const vecStr = `[${qvec!.join(',')}]`;
    const dist = sql<number>`${schema.decisionRecord.embedding} <=> ${vecStr}::vector`;

    const tier = viewerUserId
      ? sql`(${schema.decisionRecord.visibility} = 'workspace' or exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(${schema.decisionRecord.participants}, '[]'::jsonb)) = 'array' then ${schema.decisionRecord.participants} else '[]'::jsonb end) p
            where p->>'userId' = ${viewerUserId}))`
      : sql`${schema.decisionRecord.visibility} = 'workspace'`;

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
      .where(and(eq(schema.decisionRecord.status, 'confirmed'), sql`${schema.decisionRecord.embedding} is not null`, tier))
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

export interface DecisionSpanView { kind: string; utteranceIdx: number | null; speaker: string | null; tsMs: number | null; text: string }

/** Read a decision's verbatim spans as a specific viewer. Attendee-gating is enforced by the DB
 *  (RESTRICTIVE RLS on decision_span, 0008) — a non-attendee simply gets zero rows. MUST use withViewer:
 *  a withTenant read now fails closed (returns nothing), and a raw/admin read would bypass the gate. */
export async function getDecisionSpans(deps: CoreDeps, workspaceId: string, decisionId: string, viewerUserId: string): Promise<DecisionSpanView[]> {
  return deps.db.withViewer(workspaceId, viewerUserId, async (tx) => {
    return tx.select({
      kind: schema.decisionSpan.kind, utteranceIdx: schema.decisionSpan.utteranceIdx,
      speaker: schema.decisionSpan.speaker, tsMs: schema.decisionSpan.tsMs, text: schema.decisionSpan.text,
    }).from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, decisionId)).orderBy(schema.decisionSpan.tsMs);
  });
}
