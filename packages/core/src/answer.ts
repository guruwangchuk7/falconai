import type { ChatMessage } from '@falcon/llm';
import { ROLLING_WINDOW_DAYS } from '@falcon/config';
import type { CoreDeps } from './deps.js';
import { retrieve, type RetrievedItem } from './retrieve.js';
import { searchDecisions, matchUnconfirmedCandidates } from './decisions.js';
import { resolveDecisionStatus, type DecisionStatus, type UnconfirmedMatch } from './decision-status.js';

/**
 * Personal Falcon — grounded Q&A (Phase 2, spec 002-personal-falcon).
 *
 * Constitution II (Grounded or Silent): the answer gates on RETRIEVAL, not generation. The model
 * may only cite artifact IDs from the retrieved, ACL-checked candidate set; a deterministic
 * verify-then-drop pass removes any claim whose citation isn't in that set. If no claim survives,
 * we return `no_grounded_answer` rather than anything unverifiable. This is Gate 3 for answers.
 */

export interface Citation {
  artifactId: string;
  externalRef: string; // provenance the user can open (e.g. "#482", commit sha)
  title: string | null;
  type: string;
  url: string | null; // openable link to the source (null when not resolvable → UI shows a label)
  trustTier: string; // trusted | mixed | untrusted (§14) — drives the provenance-strength badge
}

/** Build an openable provenance URL from an artifact's source + repo/project + ref, so a citation
 *  is a real link, not just a label. Returns null when the source can't be resolved to a public URL
 *  (e.g. Linear/Jira, whose workspace/base URL isn't stored) — the UI falls back to a plain label. */
export function citationUrl(
  it: Pick<RetrievedItem, 'source' | 'repoOrProject' | 'type' | 'externalRef'>,
): string | null {
  if (it.source === 'github' && it.repoOrProject) {
    const base = `https://github.com/${it.repoOrProject}`;
    if (it.type === 'pr') return `${base}/pull/${it.externalRef.replace(/^#/, '')}`;
    if (it.type === 'commit') return `${base}/commit/${it.externalRef}`;
    return base; // review_comment / other → repo root (best available)
  }
  return null;
}

/** Provenance-strength badge for a claim — deterministic from the cited sources' metadata, NEVER a
 *  model self-rated confidence score (which is the unfalsifiable over-confidence testers punish). */
export type ClaimTier = 'confirmed' | 'from_comment';

/** Derive a claim's badge from its citations (pure):
 *  - `confirmed`   → grounded on a confirmed Decision Record (only confirmed records are retrievable).
 *  - `from_comment`→ the ONLY support is untrusted-tier content (a PR/ticket comment, not a record).
 *  - `null`        → anything else (a trusted PR/commit) — shown plainly, no badge, to avoid noise.
 *  "Confirmed" wins over "from_comment"; one non-untrusted source clears the caution. */
export function claimTier(citations: readonly Pick<Citation, 'type' | 'trustTier'>[]): ClaimTier | null {
  if (citations.length === 0) return null;
  if (citations.some((c) => c.type === 'decision')) return 'confirmed';
  if (citations.every((c) => c.trustTier === 'untrusted')) return 'from_comment';
  return null;
}

export interface Claim {
  text: string;
  citations: Citation[]; // >= 1 for a rendered claim
  tier?: ClaimTier; // provenance-strength badge (absent = no badge)
}

export interface Answer {
  status: 'grounded' | 'no_grounded_answer';
  claims: Claim[];
  generatedText: string | null;
  model: string;
  modelVersion: string;
  dataAsOf: string | null; // ISO; latest sync among cited artifacts (freshness, FR-014)
  degraded?: { reason: 'sync_stale' | 'source_disconnected'; sources: string[] };
  /** Present when the question asked for a range older than we've actually synced (ROLLING_WINDOW_DAYS).
   *  Surfaced so the user isn't silently handed only the last ~30 days as if it were the full answer. */
  syncWindowNote?: string;
  /** Decision Memory four-state boundary (US2). Present when a relevant confirmed decision grounded
   *  the answer and/or a relevant UNCONFIRMED candidate exists. Unconfirmed content never appears here
   *  — only metadata (count, source pointers, queue link). Absent = the `none` state. */
  decisionStatus?: DecisionStatus;
}

export interface AnswerInput {
  workspaceId: string;
  requesterUserId: string;
  question: string;
  /** Prior turns for follow-up context (FR-011). Included in the prompt but does NOT relax the
   *  grounding gate — follow-ups are re-grounded against freshly retrieved candidates. */
  history?: ChatMessage[];
  k?: number;
}

const SYSTEM =
  'You are a personal work assistant. Answer the user\'s question about their work using ONLY the ' +
  'numbered CANDIDATES provided. Never use outside knowledge, never guess, never infer beyond the ' +
  'candidates. Do not make judgments about any person\'s performance.\n\n' +
  'Return STRICT JSON, no prose, no code fences, of the form:\n' +
  '{"claims":[{"text":"<one factual sentence>","citations":[<candidate numbers that support it>]}]}\n' +
  'Rules: every claim MUST cite at least one candidate number that directly supports it. If the ' +
  'candidates do not answer the question, return {"claims":[]}. Keep claims short and factual.';

function buildCandidateBlock(items: RetrievedItem[]): string {
  return items
    .map((it, i) => `[${i + 1}] (${it.type} ${it.externalRef}) ${it.title ?? ''}\n${it.snippet}`.trim())
    .join('\n\n');
}

/** Tolerant JSON extraction — the gate does not trust formatting, but we still parse defensively. */
export function parseClaims(text: string): Array<{ text: string; citations: number[] }> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { claims?: Array<{ text?: unknown; citations?: unknown }> };
    if (!obj || !Array.isArray(obj.claims)) return null;
    return obj.claims.map((c) => ({
      text: typeof c.text === 'string' ? c.text : '',
      citations: Array.isArray(c.citations) ? c.citations.map(Number).filter((n) => Number.isInteger(n)) : [],
    }));
  } catch {
    return null;
  }
}

/**
 * The grounding gate (Constitution II), pure and unit-tested. Maps each parsed claim's 1-indexed
 * candidate citations to retrieved items; drops any citation not in the set and any claim left
 * with no valid citation or empty text. Returns surviving claims + the sync timestamps of cited
 * items (for freshness).
 */
export function groundClaims(
  parsed: Array<{ text: string; citations: number[] }>,
  items: RetrievedItem[],
): { claims: Claim[]; citedIso: string[] } {
  const claims: Claim[] = [];
  const citedIso: string[] = [];
  for (const c of parsed) {
    const citations: Citation[] = [];
    for (const n of c.citations) {
      const it = items[n - 1]; // 1-indexed candidate numbers
      if (!it) continue; // citation not in retrieved set → drop it
      // A confirmed decision resolves to its detail view (feature 005 US1); other sources use citationUrl.
      const isDecision = it.source === 'decision';
      const url = isDecision ? `/decisions/${it.artifactId}` : citationUrl(it);
      const externalRef = isDecision ? (it.title ?? 'decision') : it.externalRef;
      citations.push({ artifactId: it.artifactId, externalRef, title: it.title, type: it.type, url, trustTier: it.trustTier });
      citedIso.push(it.lastSyncedAt);
    }
    if (c.text.trim() && citations.length > 0) {
      const tier = claimTier(citations);
      claims.push({ text: c.text.trim(), citations, ...(tier ? { tier } : {}) });
    }
  }
  return { claims, citedIso };
}

/** How many top-ranked artifacts the omission diff inspects (F7.2 shadow). */
export const OMISSION_SHADOW_TOP_N = 3;

export interface OmittedArtifact { artifactId: string; title: string | null; trustTier: string; rank: number }

/**
 * F7.2 omission diff (SHADOW / log-only). Provenance-gating (groundClaims) catches a FABRICATED citation
 * — a claim citing an artifact that wasn't retrieved. It does NOT catch OMISSION: a poisoned/adversarial
 * artifact that SUPPRESSES a true citation (the agent grounds on something weaker and silently drops a
 * higher-relevance retrieved artifact). The retrieved set and the cited set are both already in memory, so
 * diff them: flag top-N retrieved ARTIFACTS (decisions are trusted, excluded) that no surviving claim
 * cited. Pure + tested. Enforcement (blocking) is Phase-4; Phase-2 ships this in shadow (log, block nothing)
 * to build a benign-traffic baseline — the build-first item the eng review flagged (A3). Returns [] when
 * every top-N artifact was cited.
 */
export function computeOmissionDiff(artifactItems: RetrievedItem[], citedArtifactIds: Set<string>, topN = OMISSION_SHADOW_TOP_N): OmittedArtifact[] {
  const omitted: OmittedArtifact[] = [];
  for (let i = 0; i < Math.min(topN, artifactItems.length); i++) {
    const it = artifactItems[i]!;
    if (!citedArtifactIds.has(it.artifactId)) {
      omitted.push({ artifactId: it.artifactId, title: it.title, trustTier: it.trustTier, rank: i + 1 });
    }
  }
  return omitted;
}

/**
 * Parse a natural-language time window from the question so "today / yesterday / this week / last
 * month" actually constrain retrieval by date (not just semantics). Pure + deterministic (takes
 * `now`). Week/month are treated as rolling windows (past 7 / 30 days) — good enough for a work
 * assistant and avoids calendar-boundary ambiguity. Returns {} when no time phrase is present.
 */
export function parseTimeWindow(question: string, now: Date): { since?: string; until?: string } {
  const q = question.toLowerCase();
  const startOfUTCDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayMs = 86_400_000;
  const todayStart = startOfUTCDay(now);

  const rolling = (days: number) => ({ since: new Date(now.getTime() - days * dayMs).toISOString(), until: now.toISOString() });

  if (/\byesterday\b/.test(q)) {
    return { since: new Date(todayStart.getTime() - dayMs).toISOString(), until: todayStart.toISOString() };
  }
  if (/\btoday\b/.test(q)) {
    return { since: todayStart.toISOString(), until: now.toISOString() };
  }
  // N-quantified windows FIRST, so "last 3 months" doesn't collapse into the bare "month" (30d) rule.
  // Months are treated as rolling 30-day units (avoids calendar-boundary ambiguity) — good enough for a
  // work assistant; a quarter is 90 days. (Fixes the silently-ignored multi-month query — R "3 months".)
  let m: RegExpMatchArray | null;
  if ((m = q.match(/\blast\s+(\d{1,2})\s+months?\b/)) || (m = q.match(/\b(\d{1,2})\s+months?\s+(?:ago|back)\b/))) {
    return rolling(Number(m[1]) * 30);
  }
  if (/\b(this|past|last)\s+quarter\b/.test(q)) return rolling(90);
  if ((m = q.match(/\blast\s+(\d{1,3})\s+weeks?\b/))) return rolling(Number(m[1]) * 7);
  if ((m = q.match(/\blast\s+(\d{1,3})\s+days?\b/)) && !/\blast\s+(7|30)\s+days?\b/.test(q)) return rolling(Number(m[1]));
  if (/\b(this|past|last)\s+(week)\b|\blast\s+7\s+days\b/.test(q)) return rolling(7);
  if (/\b(this|past|last)\s+(month)\b|\blast\s+30\s+days\b/.test(q)) return rolling(30);
  return {};
}

export async function answerQuestion(deps: CoreDeps, input: AnswerInput): Promise<Answer> {
  const model = deps.llm.chat.model;
  const base: Pick<Answer, 'model' | 'modelVersion'> = { model, modelVersion: model };

  // Embed the query ONCE and share it across retrieve / searchDecisions / matchUnconfirmedCandidates
  // (R7 — Voyage RPM). All three accept a precomputed vector.
  const queryVec = (await deps.llm.embeddings.embed([input.question], 'query'))[0]!;

  // Decision status is resolved OUTSIDE the LLM from metadata-only matches (US2). Computed up front so
  // it can be attached even to a no_grounded_answer ("not settled yet — there's an unconfirmed
  // candidate"). unconfirmedMatches carry NO decision content, so nothing here can leak into the prompt.
  let unconfirmedMatches: UnconfirmedMatch[] = [];
  let supersedingIds = new Set<string>();
  const decisionStatusFor = (claims: Claim[]): DecisionStatus | undefined =>
    resolveDecisionStatus(claims, unconfirmedMatches, supersedingIds);
  // A time phrase constrains retrieval by date ("today" / "this week" / "last 3 months"). When the asked
  // range reaches back further than we've actually synced, say so — silently returning only the last
  // ~30 days as if it were the full answer is the exact skeptic-losing truncation.
  const now = new Date();
  const window = parseTimeWindow(input.question, now);
  const syncWindowNote =
    window.since && now.getTime() - new Date(window.since).getTime() > ROLLING_WINDOW_DAYS * 86_400_000
      ? `You asked about a longer range, but Falcon has only synced about the last ${ROLLING_WINDOW_DAYS} days of your work so far — older items aren't indexed yet.`
      : undefined;
  const windowNote = syncWindowNote ? { syncWindowNote } : {};

  const noAnswer = (degraded?: Answer['degraded']): Answer => {
    const decisionStatus = decisionStatusFor([]);
    return {
      status: 'no_grounded_answer', claims: [], generatedText: null, dataAsOf: null, ...base,
      ...(degraded ? { degraded } : {}), ...(decisionStatus ? { decisionStatus } : {}), ...windowNote,
    };
  };

  // 1. Retrieve ACL/tenant-scoped candidates (the only source of truth for grounding).
  const { items: artifactItems, degraded } = await retrieve(deps, {
    workspaceId: input.workspaceId,
    requesterUserId: input.requesterUserId,
    query: input.question,
    k: input.k ?? 8,
    queryVec,
    ...(window.since ? { since: window.since } : {}),
    ...(window.until ? { until: window.until } : {}),
  });

  // Confirmed decisions are also citable candidates (FR-007: only CONFIRMED records are
  // retrievable — searchDecisions enforces this). Skip when the question is time-scoped to the
  // user's own recent activity ("today"), where org decisions aren't what's being asked.
  const items: RetrievedItem[] = [...artifactItems];
  if (!window.since) {
    const decisions = await searchDecisions(deps, input.workspaceId, input.question, 4, undefined, queryVec, input.requesterUserId);
    for (const d of decisions) {
      if (d.supersedesId) supersedingIds.add(d.id); // a settled record that replaced an older one
      items.push({
        artifactId: d.id,
        type: 'decision',
        externalRef: 'decision',
        source: 'decision', // not a URL-bearing source → answer.ts links it to /decisions/{id}
        repoOrProject: null,
        title: d.title,
        snippet: d.decision ?? d.title,
        score: d.score,
        trustTier: 'trusted',
        lastSyncedAt: d.createdAt,
        isStale: d.freshnessFlag,
      });
    }
    // Metadata-only unconfirmed matches for the status boundary (never grounding candidates).
    unconfirmedMatches = await matchUnconfirmedCandidates(deps, input.workspaceId, input.question, 4, queryVec);
  }

  if (items.length === 0) return noAnswer(degraded);

  // 2. Generate structured claims that cite candidate numbers.
  const messages: ChatMessage[] = [
    ...(input.history ?? []),
    { role: 'user', content: `CANDIDATES:\n${buildCandidateBlock(items)}\n\nQUESTION: ${input.question}` },
  ];
  const { text } = await deps.llm.chat.complete({ system: SYSTEM, messages, maxTokens: 1200, meta: { kind: 'answer', workspaceId: input.workspaceId, userId: input.requesterUserId } });

  const parsed = parseClaims(text);
  if (!parsed) return noAnswer(degraded); // unparseable → silent, never ungrounded text

  // 3. Verify-then-drop (pure, tested): keep only claims whose citations map to retrieved candidates.
  const { claims, citedIso } = groundClaims(parsed, items);
  if (claims.length === 0) return noAnswer(degraded); // nothing survived verification

  // F7.2 omission diff (SHADOW / log-only, blocks nothing): did the grounded answer skip a top-ranked
  // retrieved artifact? A high-relevance artifact left uncited can signal an injection that SUPPRESSES a
  // true citation — the case provenance-gating structurally can't see. Log a benign-traffic baseline now;
  // enforcement is Phase-4. Emitted as a greppable structured line the prod log drain forwards to Sentry.
  const citedArtifactIds = new Set(claims.flatMap((c) => c.citations.map((ci) => ci.artifactId)));
  const omitted = computeOmissionDiff(artifactItems, citedArtifactIds);
  if (omitted.length > 0) {
    console.warn('[f7.2-omission-shadow] ' + JSON.stringify({
      workspaceId: input.workspaceId, userId: input.requesterUserId,
      citedCount: citedArtifactIds.size, omitted,
    }));
  }

  const dataAsOf = citedIso.sort().at(-1) ?? null; // latest sync among cited artifacts
  const decisionStatus = decisionStatusFor(claims);
  return {
    status: 'grounded',
    claims,
    generatedText: claims.map((c) => c.text).join(' '),
    dataAsOf,
    ...base,
    ...(degraded ? { degraded } : {}),
    ...(decisionStatus ? { decisionStatus } : {}),
    ...windowNote,
  };
}
