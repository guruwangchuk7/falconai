import { and, asc, eq, inArray } from 'drizzle-orm';
import { createDb, schema } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { extractDecisions, type ScoredCandidate } from '@falcon/core';

/**
 * Offline shadow-calibration script (Ship-2 spec §7, D7 "shadow calibrate"; Task 11 — the last
 * task before enforcement). Runs the real extractor over EXISTING synced merged-PR/completed-issue
 * artifacts for a workspace and prints a score histogram + a suggestions/week estimate, so
 * `DECISION_MINE_MIN_CONFIDENCE` is set from real evidence instead of a guess (Constitution V).
 * Deliberately read-only: it never inserts into `decision_record` or `mined_artifact` — running it
 * repeatedly, or against a live workspace, cannot pollute the queue or the mine-once ledger.
 */

/** Bucket confidence scores into 0.1-wide bins (`'0.0'`..`'0.9'`); out-of-range scores clamp into
 *  the nearest edge bucket. Pure — no I/O — so it's unit-testable without a DB or LLM. */
export function scoreHistogram(scores: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const s of scores) {
    const bucket = (Math.floor(Math.min(0.99, Math.max(0, s)) * 10) / 10).toFixed(1);
    h[bucket] = (h[bucket] ?? 0) + 1;
  }
  return h;
}

/** Project an above-threshold count observed over `spanDays` onto a per-week rate. 0 for a
 *  non-positive span (avoids a divide-by-zero / negative-rate artifact on a single-day sample). */
export function suggestionsPerWeek(aboveThreshold: number, spanDays: number): number {
  return spanDays > 0 ? (aboveThreshold / spanDays) * 7 : 0;
}

/** One artifact's shadow-run result — printed as JSON for hand-labeling (spec §7 step 3). Never
 *  persisted. */
export interface ShadowRecord {
  artifactId: string;
  sourceRef: string;
  topScore: number;
  candidates: ScoredCandidate[];
}

const MINE_TYPES: string[] = ['pr', 'issue'];
const MINE_STATES: string[] = ['merged', 'completed'];
// Matches the DECISION_MINE_MIN_CONFIDENCE default this is calibrating (spec §6); the printed
// suggestions/week figure is a reference point at that threshold, not the final gate.
const SUGGEST_THRESHOLD = 0.75;

/**
 * Read EXISTING merged-PR / completed-issue artifacts for `workspaceId` (tenant-scoped, RLS via
 * `withTenant`), run the shared `extractDecisions` miner over each one, and print:
 *   - the score histogram (bucketed via `scoreHistogram`)
 *   - the suggestions/week estimate at `SUGGEST_THRESHOLD` (via `suggestionsPerWeek`)
 *   - the full per-artifact `ShadowRecord[]` as JSON (pipe to a file for hand-labeling)
 * Writes NOTHING to `decision_record` or `mined_artifact` — no `createDecision`/`recordMined` call
 * exists in this function. Needs a real Postgres (`DATABASE_URL`) and a live Haiku key
 * (`ANTHROPIC_API_KEY`); not run in unit CI.
 *
 * Usage: DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm --filter @falcon/evals exec tsx src/decision-miner-shadow.ts <workspaceId>
 */
export async function runShadow(workspaceId: string): Promise<void> {
  const db = createDb(process.env.DATABASE_URL!);
  const llm = createLlmProviders();
  try {
    const rows = await db.withTenant(workspaceId, (tx) =>
      tx
        .select({
          id: schema.artifact.id,
          externalRef: schema.artifact.externalRef,
          title: schema.artifact.title,
          body: schema.artifact.body,
          mergedClosedAt: schema.artifact.mergedClosedAt,
        })
        .from(schema.artifact)
        // Explicit workspace_id predicate (belt-and-suspenders alongside withTenant's RLS): if this
        // ever runs under a DATABASE_URL whose role bypasses RLS (e.g. superuser), the query must
        // still stay scoped to one workspace instead of silently pulling every tenant's artifacts.
        .where(and(
          eq(schema.artifact.workspaceId, workspaceId),
          inArray(schema.artifact.type, MINE_TYPES),
          inArray(schema.artifact.state, MINE_STATES),
        ))
        .orderBy(asc(schema.artifact.mergedClosedAt)),
    );

    const scores: number[] = [];
    const records: ShadowRecord[] = [];
    let firstAt: Date | null = null;
    let lastAt: Date | null = null;

    for (const r of rows) {
      const segments = [{ speaker: null, text: [r.title, r.body].filter(Boolean).join('\n\n') }];
      const candidates = await extractDecisions({ db, llm }, { segments, sourceRef: r.externalRef });
      const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
      scores.push(top);
      records.push({ artifactId: r.id, sourceRef: r.externalRef, topScore: top, candidates });
      if (r.mergedClosedAt) {
        firstAt ??= r.mergedClosedAt;
        lastAt = r.mergedClosedAt;
      }
    }

    const spanDays = firstAt && lastAt ? Math.max(1, (lastAt.getTime() - firstAt.getTime()) / 86_400_000) : 1;
    const aboveThreshold = scores.filter((s) => s >= SUGGEST_THRESHOLD).length;

    console.log('histogram', scoreHistogram(scores));
    console.log(`suggestions/week @${SUGGEST_THRESHOLD}`, suggestionsPerWeek(aboveThreshold, spanDays).toFixed(2));
    console.log(JSON.stringify(records)); // pipe to a file for hand-labeling (spec §7 step 3)
  } finally {
    await db.client.end();
  }
}

/* c8 ignore start — CLI entry; an operator script run against a real DB + live Haiku, never in
 * unit CI. Guarded on the entry file (not just argv[2]) so importing this module (e.g. via
 * `@falcon/evals` from a unit test) never triggers a real run as a side effect of import. */
const entry = process.argv[1];
if (entry && (entry.endsWith('decision-miner-shadow.ts') || entry.endsWith('decision-miner-shadow.js'))) {
  const workspaceId = process.argv[2];
  if (!workspaceId) throw new Error('Usage: tsx decision-miner-shadow.ts <workspaceId>');
  await runShadow(workspaceId);
}
/* c8 ignore stop */
