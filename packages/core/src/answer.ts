import type { ChatMessage } from '@falcon/llm';
import type { CoreDeps } from './deps.js';
import { retrieve, type RetrievedItem } from './retrieve.js';

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
}

export interface Claim {
  text: string;
  citations: Citation[]; // >= 1 for a rendered claim
}

export interface Answer {
  status: 'grounded' | 'no_grounded_answer';
  claims: Claim[];
  generatedText: string | null;
  model: string;
  modelVersion: string;
  dataAsOf: string | null; // ISO; latest sync among cited artifacts (freshness, FR-014)
  degraded?: { reason: 'sync_stale' | 'source_disconnected'; sources: string[] };
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
      citations.push({ artifactId: it.artifactId, externalRef: it.externalRef, title: it.title, type: it.type });
      citedIso.push(it.lastSyncedAt);
    }
    if (c.text.trim() && citations.length > 0) claims.push({ text: c.text.trim(), citations });
  }
  return { claims, citedIso };
}

export async function answerQuestion(deps: CoreDeps, input: AnswerInput): Promise<Answer> {
  const model = deps.llm.chat.model;
  const base: Pick<Answer, 'model' | 'modelVersion'> = { model, modelVersion: model };
  const noAnswer = (degraded?: Answer['degraded']): Answer => ({
    status: 'no_grounded_answer', claims: [], generatedText: null, dataAsOf: null, ...base, ...(degraded ? { degraded } : {}),
  });

  // 1. Retrieve ACL/tenant-scoped candidates (the only source of truth for grounding).
  const { items, degraded } = await retrieve(deps, {
    workspaceId: input.workspaceId,
    requesterUserId: input.requesterUserId,
    query: input.question,
    k: input.k ?? 8,
  });
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

  const dataAsOf = citedIso.sort().at(-1) ?? null; // latest sync among cited artifacts
  return {
    status: 'grounded',
    claims,
    generatedText: claims.map((c) => c.text).join(' '),
    dataAsOf,
    ...base,
    ...(degraded ? { degraded } : {}),
  };
}
