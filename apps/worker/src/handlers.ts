import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { captureException } from '@falcon/observability';
import {
  generateDigest, indexArtifact, upsertArtifact, type CoreDeps,
  extractDecisions, contentHash, normalizeTitle, getMinedRow, recordMined, isSuppressed,
  countSuggestionsToday, createDecision, EXTRACTOR_VERSION, shouldMine, type MineResult,
  getMinedMeeting, recordMinedMeeting, countMeetingSuggestionsToday, readWorkingCopy, getMeeting,
  deleteWorkingCopy, setTranscriptRetainedUntil, getWorkspaceRetentionDays, setWorkingCopyExpiry,
  extractMeetingDecisions, MEETING_EXTRACTOR_VERSION, chunkUtterances, dedupeBySpanOverlap,
  resolveSpans, SpanIndexError, rationalePass, type ScoredMeetingCandidate,
  extractMeetingCommitments,
} from '@falcon/core';
import type { SecretStore } from '@falcon/secrets';
import type { ArtifactInput } from '@falcon/integrations';
import { buildAdapter, type ConnectionRow } from './adapters.js';
import { digestQueue, indexQueue, mineQueue, mineJobId, syncQueue, defaultJobOpts, type DigestJob, type IndexJob, type SyncJob } from '@falcon/queue';
import {
  DECISION_MINE_MIN_CONFIDENCE, DECISION_MINE_DAILY_BUDGET,
  DECISION_MEETING_MIN_CONFIDENCE, DECISION_MEETING_DAILY_BUDGET, MEETING_CHUNK_SIZE, MEETING_RATIONALE_PASS_TOP_N,
} from '@falcon/config';

/** Milliseconds from `now` until the next UTC midnight (when the daily suggestion budget resets).
 *  Used by the meeting-extract defer re-enqueue. Pure/testable; the jitter is added at the call site. */
export function msUntilNextUtcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

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
      await indexQueue().add('index', { workspaceId, artifactId }, defaultJobOpts);

      // Ship 2: enqueue a mine job for freshly merged PRs / completed issues (after the watermark).
      const mcAt = it.mergedClosedAt ? new Date(it.mergedClosedAt) : null;
      if (shouldMine({ type: it.type, state: it.state ?? null, mergedClosedAt: mcAt }, conn.mineWatermark ?? null)) {
        const segs = [{ speaker: null, text: [it.title, it.body].filter(Boolean).join('\n\n') }];
        const jobId = mineJobId(workspaceId, artifactId, EXTRACTOR_VERSION, contentHash(segs));
        await mineQueue().add('mine', { workspaceId, artifactId }, { ...defaultJobOpts, jobId });
      }
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

export interface MineOutcome { result: MineResult; decisionIds: string[] }

/**
 * Ship 2 decision miner orchestration: mine-once ledger gate, daily budget gate, LLM extraction
 * (error-safe), confidence threshold + suppression, and creation of `origin='suggested'` decision
 * records. PROVENANCE GATE (security): the created record's `sourceRef` is always the triggering
 * artifact's `externalRef` — NEVER any `sourceRef` the model may have emitted in its JSON output.
 */
export async function handleMine(deps: CoreDeps, payload: { workspaceId: string; artifactId: string }): Promise<MineOutcome> {
  const { workspaceId, artifactId } = payload;
  const art = await deps.db.withTenant(workspaceId, async (tx) =>
    (await tx.select().from(schema.artifact).where(eq(schema.artifact.id, artifactId)).limit(1))[0]);
  if (!art) return { result: 'no_decision', decisionIds: [] }; // artifact gone

  const segments = [{ speaker: null, text: [art.title, art.body].filter(Boolean).join('\n\n') }];
  const hash = contentHash(segments);

  // Ledger gate: skip iff a row exists at the current version AND hash (any result).
  const prior = await getMinedRow(deps, workspaceId, artifactId);
  if (prior && prior.extractorVersion === EXTRACTOR_VERSION && prior.contentHash === hash) {
    return { result: prior.result, decisionIds: [] };
  }

  // Budget gate: over budget → defer (write NOTHING; Task 8 re-enqueues with delay).
  if (await countSuggestionsToday(deps, workspaceId) >= DECISION_MINE_DAILY_BUDGET) {
    return { result: 'deferred', decisionIds: [] };
  }

  // Transient LLM/API errors (network/5xx/429) THROW → propagate out so BullMQ retries (spec §5).
  // We must NOT write an 'error' ledger row here: that would pin the artifact at this version+hash
  // and the ledger gate would then permanently skip it, silently dropping the PR's decision forever.
  // Malformed JSON never reaches here — extractDecisions handles it internally (returns [] after a
  // re-call). The reserved 'error' MineResult value stays in the union/CHECK constraint, now unused.
  const candidates = await extractDecisions(deps, { segments, sourceRef: art.externalRef, ownerHint: art.userId });

  const maxScore = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  const decisionIds: string[] = [];
  // Within-run dedup: an extraction can return two candidates with the same normalized title;
  // isSuppressed only sees rows already committed to the DB, so two same-titled candidates in
  // one run would both pass it (neither is written yet) and create duplicate suggested records.
  // Track titles created THIS run locally to catch that case too.
  const createdTitlesThisRun = new Set<string>();
  for (const c of candidates) {
    if (c.score < DECISION_MINE_MIN_CONFIDENCE) continue;
    const norm = normalizeTitle(c.title);
    if (createdTitlesThisRun.has(norm)) continue;
    if (await isSuppressed(deps, workspaceId, art.externalRef, norm)) continue;
    const { id } = await createDecision(deps, workspaceId, {
      title: c.title, decision: c.decision,
      ...(c.rationale !== undefined && { rationale: c.rationale }),
      ...(c.options !== undefined && { options: c.options }),
      ...(c.dissent !== undefined && { dissent: c.dissent }),
      ownerUserId: art.userId, sourceRef: art.externalRef, origin: 'suggested', // provenance: artifact ref, NEVER model output
    });
    createdTitlesThisRun.add(norm);
    decisionIds.push(id);
  }
  const result: MineResult = decisionIds.length ? 'suggested' : 'no_decision';
  await recordMined(deps, workspaceId, artifactId, {
    result, extractorVersion: EXTRACTOR_VERSION, contentHash: hash,
    decisionId: decisionIds[0] ?? null, maxCandidateScore: maxScore || null,
  });
  return { result, decisionIds };
}

export interface MeetingExtractOutcome { result: MineResult; decisionIds: string[] }

/**
 * In-meeting listener orchestration (meeting analog of handleMine). Post-meeting extraction over the
 * DURABLE working copy (never Redis). PROVENANCE (F7.2): sourceRef is ALWAYS `meeting:{meetingId}`,
 * never model output. Records are origin='meeting', visibility='workspace', unconfirmed (R23 — never
 * auto-confirms). Ledger keyed on meetingId + MEETING_EXTRACTOR_VERSION (no contentHash — immutable
 * transcript). Retention: on -> keep+extend working copy; off -> delete, spans persist as citation.
 */
export async function handleMeetingExtract(deps: CoreDeps, payload: { workspaceId: string; meetingId: string }): Promise<MeetingExtractOutcome> {
  const { workspaceId, meetingId } = payload;

  // 1. Ledger gate — skip iff already mined at this extractor version (immutable transcript, no hash).
  const prior = await getMinedMeeting(deps, workspaceId, meetingId);
  if (prior && prior.extractorVersion === MEETING_EXTRACTOR_VERSION) return { result: prior.result, decisionIds: [] };

  // 2. Load meeting + durable working copy.
  const meeting = await getMeeting(deps, workspaceId, meetingId);
  if (!meeting) return { result: 'no_decision', decisionIds: [] }; // meeting gone
  const wc = await readWorkingCopy(deps, workspaceId, meetingId);
  if (!wc || wc.utterances.length === 0) {
    // transcript discarded (e.g. deferred past the working-copy TTL) or empty — nothing to extract.
    await recordMinedMeeting(deps, workspaceId, meetingId, { result: 'no_decision', extractorVersion: MEETING_EXTRACTOR_VERSION, transcriptRetainedUntil: meeting.transcriptRetainedUntil });
    return { result: 'no_decision', decisionIds: [] };
  }

  // 3. Budget gate (reserved meeting lane) — over budget → defer (write NOTHING; the worker re-enqueues).
  if (await countMeetingSuggestionsToday(deps, workspaceId) >= DECISION_MEETING_DAILY_BUDGET) return { result: 'deferred', decisionIds: [] };

  // 4. Chunk + extract.
  const utterances = wc.utterances;
  const byIdx = new Map(utterances.map((u) => [u.idx, u]));
  const indexed = utterances.map((u) => ({ idx: u.idx, speaker: u.speaker, text: u.text }));
  const sourceRef = `meeting:${meetingId}`;
  const raw: ScoredMeetingCandidate[] = [];
  for (const chunk of chunkUtterances(indexed, MEETING_CHUNK_SIZE)) {
    raw.push(...(await extractMeetingDecisions(deps, { utterances: chunk, sourceRef, ownerHint: null })));
  }
  const maxScore = raw.reduce((m, c) => Math.max(m, c.score), 0);

  // 5. Threshold (+ require a decision span, D9) + cross-chunk dedup.
  const deduped = dedupeBySpanOverlap(raw.filter((c) => c.score >= DECISION_MEETING_MIN_CONFIDENCE && c.decisionSpans.length > 0));

  // 6. Targeted rationale pass for the top-N (recovers out-of-chunk rationale). Merge, dedup indices.
  for (const c of [...deduped].sort((a, b) => b.score - a.score).slice(0, MEETING_RATIONALE_PASS_TOP_N)) {
    const extra = await rationalePass(deps, { title: c.title, decision: c.decision }, indexed, sourceRef);
    c.rationaleSpans = Array.from(new Set([...c.rationaleSpans, ...extra]));
  }

  // 7. Resolve spans + create records (within-run dedup + suggest-time suppression + provenance).
  const decisionIds: string[] = [];
  const createdTitles = new Set<string>();
  let hadError = false;
  for (const c of deduped) {
    const norm = normalizeTitle(c.title);
    if (createdTitles.has(norm)) continue;
    if (await isSuppressed(deps, workspaceId, sourceRef, norm)) continue;
    let spans;
    try { spans = resolveSpans(c, byIdx); }
    catch (e) { if (e instanceof SpanIndexError) { hadError = true; continue; } throw e; } // out-of-range → drop candidate
    const { id } = await createDecision(deps, workspaceId, {
      title: c.title, decision: c.decision,
      ...(c.rationale !== undefined && { rationale: c.rationale }),
      ...(c.options !== undefined && { options: c.options }),
      ...(c.dissent !== undefined && { dissent: c.dissent }),
      // visibility is left UNSET (NULL) on purpose — a meeting decision is unchosen until a human picks
      // at confirm (D13). NULL keeps the draft attendee-scoped in the queue instead of workspace-visible.
      sourceRef, origin: 'meeting', participants: meeting.attendees, spans,
    });
    createdTitles.add(norm);
    decisionIds.push(id);
  }

  // 7b. Commitment overlay (showcase feature) — an ISOLATED, error-contained pass over the same
  // transcript. Commitments are a lightweight side-record ("what did I promise?"); a failure here must
  // NEVER regress the proven decision path above, so it is fully wrapped and its outcome does not feed
  // `result` or the ledger. Same provenance discipline (sourceRef=meeting:{id}, evidence = resolved line).
  try {
    await extractMeetingCommitments(deps, workspaceId, { meetingId, utterances: indexed });
  } catch (e) {
    captureException(e, { kind: 'commitment-extract', workspaceId, meetingId });
  }

  // 8. Compute result BEFORE the retention step so the error branch can decide whether to preserve
  // the working copy (D6/D7).
  const result: MineResult = decisionIds.length ? 'suggested' : hadError ? 'error' : 'no_decision';

  // 9. Retention: on → keep + extend the working copy; off → delete it (spans already persisted) —
  // UNLESS extraction produced a pure error (every candidate hit SpanIndexError: zero decisions,
  // zero spans persisted). In that case, preserve the transcript for a re-mine recovery window
  // instead of discarding the irreplaceable meeting with nothing to show for it (D6/D7). Its
  // existing 24-72h working-copy TTL still bounds it — we're just not proactively deleting.
  const days = await getWorkspaceRetentionDays(deps, workspaceId);
  let retainedUntil: Date | null = null;
  if (days > 0) {
    retainedUntil = new Date(Date.now() + days * 86_400_000);
    await setWorkingCopyExpiry(deps, workspaceId, meetingId, retainedUntil);
    await setTranscriptRetainedUntil(deps, workspaceId, meetingId, retainedUntil);
  } else if (result !== 'error') {
    await deleteWorkingCopy(deps, workspaceId, meetingId);
    await setTranscriptRetainedUntil(deps, workspaceId, meetingId, null);
  } else {
    // preserve transcript on error for re-mine recovery, D6/D7. Retention is still off — we just
    // don't proactively delete the working copy.
    await setTranscriptRetainedUntil(deps, workspaceId, meetingId, null);
  }

  // 10. Ledger.
  await recordMinedMeeting(deps, workspaceId, meetingId, { result, extractorVersion: MEETING_EXTRACTOR_VERSION, transcriptRetainedUntil: retainedUntil, decisionId: decisionIds[0] ?? null, maxCandidateScore: maxScore || null });
  return { result, decisionIds };
}

/** Poll scheduler: iterate workspaces (not RLS'd) and enqueue a sync per active connection. */
export async function pollAll(deps: CoreDeps): Promise<void> {
  const workspaces = await deps.db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace);
  for (const ws of workspaces) {
    const conns = await deps.db.withTenant(ws.id, (tx) =>
      tx.select({ id: schema.connection.id }).from(schema.connection).where(eq(schema.connection.status, 'active')),
    );
    for (const c of conns) await syncQueue().add('sync', { workspaceId: ws.id, connectionId: c.id }, defaultJobOpts);
  }
}

/** Nightly: enqueue a digest job per (workspace, member). */
export async function pollDigests(deps: CoreDeps): Promise<void> {
  const rows = await deps.db.rootDb
    .select({ workspaceId: schema.membership.workspaceId, userId: schema.membership.userId })
    .from(schema.membership);
  for (const r of rows) await digestQueue().add('digest', { workspaceId: r.workspaceId, userId: r.userId }, defaultJobOpts);
}
