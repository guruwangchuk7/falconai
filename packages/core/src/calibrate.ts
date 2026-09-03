import type { CoreDeps } from './deps.js';
import { normalizeTitle } from './decision-mine.js';
import { extractMeetingDecisions, chunkUtterances, type IndexedUtterance } from './meeting-extract.js';
import { MEETING_CHUNK_SIZE } from '@falcon/config';

/**
 * Threshold calibration for DECISION_MEETING_MIN_CONFIDENCE. The suggest-time cutoff is currently a
 * GUESS (0.75); this is the tooling that replaces the guess with a measurement once a labeled meeting
 * corpus exists. Extraction on real conversation (reversals, overlap, distant rationale) is where the
 * cutoff actually bites — see docs/in-meeting-listener-state.md. The pure sweep math is separated from
 * the LLM runner so the precision/recall logic is deterministically testable without a model or a corpus.
 */

/** One labeled meeting in the eval corpus. `gold` = the decisions a human says SHOULD be extracted
 *  (empty array = a genuine no-decision meeting — critical for measuring false positives). */
export interface LabeledMeeting {
  id: string;
  utterances: IndexedUtterance[];
  gold: { title: string }[];
}

/** A candidate as scored by the extractor (title + confidence), per meeting — the runner's output and
 *  the sweep's input. Kept separate from ScoredMeetingCandidate so a corpus of pre-extracted candidates
 *  can be swept without re-running the model. */
export interface ScoredForCalibration { title: string; score: number }
export interface ExtractedMeeting { id: string; candidates: ScoredForCalibration[]; gold: { title: string }[] }

export interface ThresholdRow { threshold: number; tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }
export interface CalibrationReport { rows: ThresholdRow[]; recommended: number }

const MATCH_JACCARD = 0.5; // a candidate matches a gold when ≥half their normalized-title tokens overlap

function tokenSet(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(/\s+/).filter(Boolean));
}

/** A candidate matches a gold decision by normalized-title token overlap (Jaccard ≥ 0.5). A heuristic —
 *  real calibration may hand-verify borderline matches — but deterministic and good enough to rank thresholds. */
export function titlesMatch(a: string, b: string): boolean {
  const sa = tokenSet(a), sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return false;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union > 0 && inter / union >= MATCH_JACCARD;
}

const DEFAULT_THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

/**
 * PURE: sweep confidence thresholds over already-extracted+labeled meetings. At each threshold, a
 * candidate scoring ≥ t is "predicted". Per meeting: TP = gold decisions captured by ≥1 predicted
 * candidate; FN = gold decisions no predicted candidate matched; FP = predicted candidates matching no
 * gold (a duplicate hit on the same gold is not an FP — the pipeline dedups). Recommends the max-F1
 * threshold (ties break toward the HIGHER cutoff — precision is the safer default for a suggestion queue).
 */
export function sweepThresholds(meetings: ExtractedMeeting[], thresholds: number[] = DEFAULT_THRESHOLDS): CalibrationReport {
  const rows: ThresholdRow[] = thresholds.map((threshold) => {
    let tp = 0, fp = 0, fn = 0;
    for (const m of meetings) {
      const predicted = m.candidates.filter((c) => c.score >= threshold);
      const goldHit = m.gold.map(() => false);
      for (const c of predicted) {
        const gi = m.gold.findIndex((g) => titlesMatch(c.title, g.title));
        if (gi >= 0) goldHit[gi] = true; else fp++;
      }
      tp += goldHit.filter(Boolean).length;
      fn += goldHit.filter((h) => !h).length;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { threshold, tp, fp, fn, precision, recall, f1 };
  });
  let recommended = rows[0]?.threshold ?? 0;
  let best = -1;
  for (const r of rows) if (r.f1 > best || (r.f1 === best && r.threshold > recommended)) { best = r.f1; recommended = r.threshold; }
  return { rows, recommended };
}

/** RUNNER: extract candidates for each labeled meeting via the real model, then sweep. One LLM call per
 *  chunk per meeting — run against a real corpus with a real provider. Returns both the per-meeting
 *  extractions (keep them: re-sweeping is free, re-extracting costs money) and the swept report. */
export async function calibrateMeetingThreshold(
  deps: CoreDeps, corpus: LabeledMeeting[], thresholds: number[] = DEFAULT_THRESHOLDS,
): Promise<{ extracted: ExtractedMeeting[]; report: CalibrationReport }> {
  const extracted: ExtractedMeeting[] = [];
  for (const m of corpus) {
    const candidates: ScoredForCalibration[] = [];
    for (const chunk of chunkUtterances(m.utterances, MEETING_CHUNK_SIZE)) {
      const scored = await extractMeetingDecisions(deps, { utterances: chunk, sourceRef: `calibrate:${m.id}` });
      candidates.push(...scored.map((c) => ({ title: c.title, score: c.score })));
    }
    extracted.push({ id: m.id, candidates, gold: m.gold });
  }
  return { extracted, report: sweepThresholds(extracted, thresholds) };
}
