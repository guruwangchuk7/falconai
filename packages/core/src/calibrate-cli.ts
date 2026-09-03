/**
 * Calibrate DECISION_MEETING_MIN_CONFIDENCE against a labeled meeting corpus.
 *
 *   pnpm --filter @falcon/core calibrate <path/to/corpus.json>
 *
 * Corpus format: LabeledMeeting[] — see docs/calibration/README.md and docs/calibration/sample-meeting-corpus.json.
 * Runs the REAL extractor (one LLM call per chunk per meeting — costs money) once, then sweeps thresholds
 * over the cached candidates. Prints a precision/recall/F1 table and the recommended cutoff. Pick the
 * threshold deliberately — max-F1 is the default, but a suggestion queue often wants a precision floor.
 */
import { readFileSync } from 'node:fs';
import { createLlmProviders } from '@falcon/llm';
import { calibrateMeetingThreshold, type CoreDeps, type LabeledMeeting } from './index.js';

const path = process.argv[2];
if (!path) { console.error('usage: calibrate <corpus.json>'); process.exit(1); }

const corpus = JSON.parse(readFileSync(path, 'utf8')) as LabeledMeeting[];
if (!Array.isArray(corpus) || corpus.length === 0) { console.error('corpus is empty or not an array'); process.exit(1); }

const deps = { llm: createLlmProviders() } as CoreDeps; // db unused by the extractor
const goldTotal = corpus.reduce((n, m) => n + m.gold.length, 0);
console.error(`Extracting ${corpus.length} meetings (${goldTotal} gold decisions) with the real model…`);

const { report } = await calibrateMeetingThreshold(deps, corpus);

console.log('\nthreshold  TP  FP  FN   precision  recall   F1');
for (const r of report.rows) {
  console.log(
    `  ${r.threshold.toFixed(2)}    ${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} ${String(r.fn).padStart(3)}` +
    `     ${r.precision.toFixed(2)}     ${r.recall.toFixed(2)}   ${r.f1.toFixed(2)}`,
  );
}
console.log(`\nRecommended (max F1): ${report.recommended.toFixed(2)}  (current default: 0.75)`);
process.exit(0);
