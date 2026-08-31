// Phase 3 (spec 004-pairing, T023) — server-arrival ordering (AD-1 / research R1): order by arrival,
// mark ambiguous when error margins overlap (F5.3/R5), never drop, preserve gaps (§12.6).
import { it, expect } from 'vitest';
import { mergeUtterances, mergedTranscript, type RawUtterance } from '../../apps/session-worker/src/merge.js';
import type { SessionEvent } from '../../apps/session-worker/src/eventlog.js';

const u = (seq: number, userId: string, text: string, arrivalTs: number, errorMarginMs = 10): RawUtterance => ({
  seq,
  userId,
  clientSeq: seq,
  text,
  arrivalTs,
  errorMarginMs,
});

it('orders by server arrival and never drops', () => {
  const merged = mergeUtterances([u(3, 'a', 'third', 300), u(1, 'a', 'first', 100), u(2, 'b', 'second', 200)]);
  expect(merged.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  expect(merged).toHaveLength(3);
});

it('marks ambiguous order when error margins overlap (F5.3/R5)', () => {
  // 15ms apart, each ±10ms → sum 20 ≥ 15 → overlap → ambiguous.
  const merged = mergeUtterances([u(1, 'a', 'x', 100, 10), u(2, 'b', 'y', 115, 10)]);
  expect(merged.every((m) => m.ambiguousOrder)).toBe(true);
  expect(merged.every((m) => m.orderConfidence < 1)).toBe(true);
});

it('confident order when arrivals are well separated', () => {
  const merged = mergeUtterances([u(1, 'a', 'x', 100, 10), u(2, 'b', 'y', 500, 10)]);
  expect(merged.every((m) => !m.ambiguousOrder)).toBe(true);
  expect(merged.every((m) => m.orderConfidence === 1)).toBe(true);
});

it('folds the event log into transcript + preserves gaps (never a silent hole)', () => {
  const events: SessionEvent[] = [
    { id: '1-0', seq: 1, type: 'utterance_final', payload: { userId: 'a', clientSeq: 1, text: 'hi', arrivalTs: 100, errorMarginMs: 5 } },
    { id: '2-0', seq: 2, type: 'transcript_gap', payload: { userId: 'b', reason: 'stt_total_loss' } },
    { id: '3-0', seq: 3, type: 'utterance_final', payload: { userId: 'b', clientSeq: 1, text: 'yo', arrivalTs: 200, errorMarginMs: 5 } },
  ];
  const { utterances, gaps } = mergedTranscript(events);
  expect(utterances.map((m) => `${m.userId}:${m.text}`)).toEqual(['a:hi', 'b:yo']);
  expect(gaps).toEqual([{ seq: 2, userId: 'b', reason: 'stt_total_loss' }]);
});
