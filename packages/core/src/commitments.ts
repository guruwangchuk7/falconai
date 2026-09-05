import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { COMMITMENT_MIN_CONFIDENCE, MEETING_CHUNK_SIZE } from '@falcon/config';
import type { CoreDeps } from './deps.js';
import { normalizeTitle } from './decision-mine.js';
import { chunkUtterances, type IndexedUtterance } from './meeting-extract.js';
import { extractCommitments } from './commitment-extract.js';

export interface CreateCommitmentInput {
  text: string;
  ownerHint?: string | null;
  counterparty?: string | null;
  dueHint?: string | null;
  sourceRef?: string | null;
  meetingId?: string | null;
  evidenceSpeaker?: string | null;
  evidenceText: string;               // the receipt — the verbatim transcript line (never model-authored)
  evidenceUtteranceIdx?: number | null;
}

export interface CommitmentRow {
  id: string;
  text: string;
  ownerHint: string | null;
  counterparty: string | null;
  dueHint: string | null;
  status: 'open' | 'done';
  sourceRef: string | null;
  evidenceSpeaker: string | null;
  evidenceText: string;
  createdAt: string;
  doneAt: string | null;
}

/** Persist one commitment (tenant-scoped, RLS). Provenance: `sourceRef` + `evidenceText` come from the
 *  caller (the meeting id and the resolved transcript line) — NEVER from anything the model authored. */
export async function createCommitment(deps: CoreDeps, workspaceId: string, input: CreateCommitmentInput): Promise<{ id: string }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx
      .insert(schema.commitment)
      .values({
        workspaceId,
        text: input.text,
        ownerHint: input.ownerHint ?? null,
        counterparty: input.counterparty ?? null,
        dueHint: input.dueHint ?? null,
        status: 'open',
        sourceRef: input.sourceRef ?? null,
        meetingId: input.meetingId ?? null,
        evidenceSpeaker: input.evidenceSpeaker ?? null,
        evidenceText: input.evidenceText,
        evidenceUtteranceIdx: input.evidenceUtteranceIdx ?? null,
      })
      .returning({ id: schema.commitment.id });
    return { id: row!.id };
  });
}

/** List commitments, newest first. `status` filters open/done (default: all). Tenant-scoped (RLS). */
export async function listCommitments(
  deps: CoreDeps,
  workspaceId: string,
  opts: { status?: 'open' | 'done' } = {},
): Promise<CommitmentRow[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const where = opts.status
      ? and(eq(schema.commitment.workspaceId, workspaceId), eq(schema.commitment.status, opts.status))
      : eq(schema.commitment.workspaceId, workspaceId);
    const rows = await tx.select().from(schema.commitment).where(where).orderBy(desc(schema.commitment.createdAt));
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      ownerHint: r.ownerHint,
      counterparty: r.counterparty,
      dueHint: r.dueHint,
      status: r.status as 'open' | 'done',
      sourceRef: r.sourceRef,
      evidenceSpeaker: r.evidenceSpeaker,
      evidenceText: r.evidenceText,
      createdAt: r.createdAt.toISOString(),
      doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    }));
  });
}

/** Count of still-open commitments (feeds the sidebar badge). Tenant-scoped (RLS). */
export async function countOpenCommitments(deps: CoreDeps, workspaceId: string): Promise<number> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.commitment)
      .where(and(eq(schema.commitment.workspaceId, workspaceId), eq(schema.commitment.status, 'open')));
    return r?.n ?? 0;
  });
}

/** Toggle a commitment open⇄done. Idempotent; stamps `done_at` on close, clears it on reopen. */
export async function setCommitmentDone(
  deps: CoreDeps,
  workspaceId: string,
  id: string,
  done: boolean,
): Promise<{ status: 'open' | 'done' | 'not_found' }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx.select({ id: schema.commitment.id }).from(schema.commitment).where(eq(schema.commitment.id, id)).limit(1);
    if (!row) return { status: 'not_found' }; // absent, or another tenant's row (RLS hides it)
    const next = done ? 'done' : 'open';
    await tx
      .update(schema.commitment)
      .set({ status: next, doneAt: done ? new Date() : null })
      .where(eq(schema.commitment.id, id));
    return { status: next };
  });
}

/**
 * Orchestrator: extract commitments from a meeting's transcript and persist them (the meeting analog of
 * the decision loop, but isolated). Chunks the transcript, extracts, applies the confidence threshold,
 * dedups by normalized text across chunks, resolves each commitment's FIRST valid span to a verbatim
 * evidence line (the receipt), and creates the records. PROVENANCE (F7.2): sourceRef is always
 * `meeting:{meetingId}` and evidence is the resolved transcript line — never model output. A span index
 * the model invents but the transcript lacks simply drops that candidate; it never fabricates a receipt.
 * Returns the created commitment ids. The CALLER runs this error-contained so a failure never touches
 * the decision path.
 */
export async function extractMeetingCommitments(
  deps: CoreDeps,
  workspaceId: string,
  args: { meetingId: string; utterances: IndexedUtterance[] },
): Promise<string[]> {
  const byIdx = new Map(args.utterances.map((u) => [u.idx, u]));
  const sourceRef = `meeting:${args.meetingId}`;

  const raw = [];
  for (const chunk of chunkUtterances(args.utterances, MEETING_CHUNK_SIZE)) {
    raw.push(...(await extractCommitments(deps, { utterances: chunk, sourceRef })));
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const c of raw.sort((a, b) => b.score - a.score)) {
    if (c.score < COMMITMENT_MIN_CONFIDENCE) continue;
    // Resolve the FIRST cited span that actually exists → the receipt. No valid span → drop (no receipt,
    // no commitment): a commitment without a verbatim line to point at is unverifiable.
    const evidence = c.spans.map((i) => byIdx.get(i)).find((u) => u !== undefined);
    if (!evidence) continue;
    const norm = normalizeTitle(c.text);
    if (seen.has(norm)) continue; // cross-chunk dedup on the promise text
    seen.add(norm);
    const { id } = await createCommitment(deps, workspaceId, {
      text: c.text,
      ownerHint: c.ownerHint,
      counterparty: c.counterparty,
      dueHint: c.dueHint,
      sourceRef,
      meetingId: args.meetingId,
      evidenceSpeaker: evidence.speaker,
      evidenceText: evidence.text,
      evidenceUtteranceIdx: evidence.idx,
    });
    ids.push(id);
  }
  return ids;
}
