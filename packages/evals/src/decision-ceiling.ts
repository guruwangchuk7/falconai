/**
 * Decision Memory relevance-ceiling calibration (feature 005, research.md R1; task T001/T002).
 *
 * The status resolver surfaces an UNCONFIRMED decision candidate as answer metadata only when the
 * candidate is *actually relevant* to the question. "Relevant" is a maximum cosine DISTANCE cutoff
 * (`DECISION_RELEVANCE_MAX_DISTANCE`). Picking that cutoff blind is forbidden (Constitution V —
 * measure the judgment): this fixture seeds a labeled corpus, embeds it with the pinned model, and
 * reports the distance distribution + precision/recall so the cutoff is chosen from evidence.
 *
 * RUN (needs a live Voyage key — flagged; does NOT run offline):
 *   VOYAGE_API_KEY=… pnpm --filter @falcon/evals exec tsx src/decision-ceiling.ts
 * Then record the chosen value + table in specs/005-decision-memory/research.md (R1 result) and set
 * DECISION_RELEVANCE_MAX_DISTANCE in packages/config.
 */
import { cosine } from './recall.js';
import { voyageEmbed } from './voyage.js';

const MODEL = 'voyage-code-4'; // pinned — matches @falcon/llm EMBEDDING_MODEL

/** Seed decisions (documents). Drawn from this repo's real decision history to be representative. */
export const CEILING_DECISIONS: { id: string; text: string }[] = [
  { id: 'stt', text: 'Adopted Deepgram Nova as the primary streaming STT provider, with AssemblyAI as failover behind a circuit breaker.' },
  { id: 'memory-first', text: 'Ship the memory/knowledge layer (Decision Records + grounded Q&A) to engineers before live mediation, based on tester feedback that the live transcript had no standalone value.' },
  { id: 'privacy', text: 'Per-person private transcript: raw words stay private; only grounded blame-neutral cards are shared across paired participants.' },
  { id: 'host', text: 'Deploy the pilot on a $0 Oracle Cloud always-free VM instead of Fly.io, since Fly is no longer free and funding is paused.' },
  { id: 'rls', text: 'Enforce tenant isolation at the database layer via Postgres RLS with a non-superuser app role, not app-layer predicates.' },
  { id: 'models', text: 'Pin explicit LLM/embedding model versions; never use -latest. Model upgrades are code changes gated on an eval.' },
  { id: 'text-only', text: 'Falcon never emits audio into a meeting; it only writes. Text-only, permanently in v1.' },
  { id: 'embeddings', text: 'Use Voyage voyage-code-4 at 1024 dimensions for artifact and decision embeddings.' },
  // ... extend to ~25 for a real run; abbreviated here for the committed fixture.
];

/** Unrelated decisions — negatives should NOT match questions about the topics above. */
export const CEILING_DISTRACTORS: { id: string; text: string }[] = [
  { id: 'coffee', text: 'The office switched to a new espresso machine supplier for the kitchen.' },
  { id: 'logo', text: 'The marketing team picked a new shade of blue for the website footer.' },
  { id: 'holiday', text: 'The company observes an extra floating holiday in December.' },
];

/** Labeled questions: each maps to the decision id it SHOULD match, or null for "nothing relevant". */
export const CEILING_QUERIES: { q: string; expect: string | null }[] = [
  { q: 'Why did we choose Deepgram for speech to text?', expect: 'stt' },
  { q: 'Are we changing our transcription provider?', expect: 'stt' },
  { q: 'Why are we building the memory layer before live meetings?', expect: 'memory-first' },
  { q: 'How do we keep meeting transcripts private?', expect: 'privacy' },
  { q: 'Where are we hosting the pilot?', expect: 'host' },
  { q: 'How is tenant isolation enforced?', expect: 'rls' },
  { q: 'What is our policy on LLM model versions?', expect: 'models' },
  // negatives — no seeded decision answers these:
  { q: 'What is our parental leave policy?', expect: null },
  { q: 'Which CRM did sales pick?', expect: null },
  { q: 'What is the reimbursement limit for travel?', expect: null },
];

export interface CeilingRow { q: string; expect: string | null; nearestId: string; distance: number }
export interface CeilingReport {
  rows: CeilingRow[];
  /** For each candidate cutoff, precision/recall of "surface a candidate" vs the labels. */
  sweep: { cutoff: number; precision: number; recall: number; falsePositives: number }[];
  recommended: number;
}

/** cosine distance = 1 - cosine similarity (matches pgvector `<=>` on normalized vectors). */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosine(a, b);
}

/**
 * Embed the seeded corpus + questions, find each question's nearest decision, and sweep cutoffs.
 * Recommends the STRICTEST cutoff that yields ZERO false positives on negatives while retaining the
 * most true matches (precision-first — a spurious "there's a candidate" footer is the death-by-noise
 * failure mode). Pure ranking math; the only I/O is the embed call.
 */
export async function runDecisionCeiling(apiKey: string): Promise<CeilingReport> {
  const docs = [...CEILING_DECISIONS, ...CEILING_DISTRACTORS];
  const docVecs = await voyageEmbed(docs.map((d) => d.text), MODEL, apiKey, 'document');
  const qVecs = await voyageEmbed(CEILING_QUERIES.map((c) => c.q), MODEL, apiKey, 'query');

  const rows: CeilingRow[] = CEILING_QUERIES.map((c, qi) => {
    let best = { id: docs[0]!.id, distance: Infinity };
    docs.forEach((d, di) => {
      const dist = cosineDistance(qVecs[qi]!, docVecs[di]!);
      if (dist < best.distance) best = { id: d.id, distance: dist };
    });
    return { q: c.q, expect: c.expect, nearestId: best.id, distance: best.distance };
  });

  // Sweep cutoffs from strict→loose; a "surface" decision = nearest distance <= cutoff.
  const candidates = Array.from(new Set(rows.map((r) => Number(r.distance.toFixed(3))))).sort((a, b) => a - b);
  const sweep = candidates.map((cutoff) => {
    let tp = 0, fp = 0, fn = 0;
    for (const r of rows) {
      const surfaced = r.distance <= cutoff;
      const shouldSurface = r.expect !== null;
      const correctTarget = surfaced && r.nearestId === r.expect;
      if (shouldSurface && correctTarget) tp++;
      else if (!shouldSurface && surfaced) fp++;
      else if (shouldSurface && !surfaced) fn++;
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    return { cutoff, precision, recall, falsePositives: fp };
  });

  // Strictest cutoff with zero false positives and the best recall among those.
  const clean = sweep.filter((s) => s.falsePositives === 0);
  const recommended = clean.length ? clean.reduce((a, b) => (b.recall > a.recall ? b : a)).cutoff : 0;
  return { rows, sweep, recommended };
}

/* c8 ignore start — CLI entry; exercised manually with a live key, not in unit CI. */
if (process.argv[1] && process.argv[1].endsWith('decision-ceiling.ts')) {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY required to run the decision-ceiling calibration.');
  runDecisionCeiling(key).then((r) => {
    console.table(r.rows.map((x) => ({ ...x, distance: x.distance.toFixed(3) })));
    console.table(r.sweep.map((s) => ({ cutoff: s.cutoff, precision: s.precision.toFixed(2), recall: s.recall.toFixed(2), fp: s.falsePositives })));
    console.log(`\nRecommended DECISION_RELEVANCE_MAX_DISTANCE = ${r.recommended}`);
  });
}
/* c8 ignore stop */
