import { describe, it, expect } from 'vitest';
import { chunkUtterances, resolveSpans, dedupeBySpanOverlap, SpanIndexError,
         type IndexedUtterance, type ScoredMeetingCandidate } from '@falcon/core';
import type { Utterance } from '@falcon/core';

const idx = (i: number): IndexedUtterance => ({ idx: i, speaker: `s${i}`, text: `t${i}` });
const utt = (i: number): Utterance => ({ idx: i, speaker: `s${i}`, userId: `u${i}`, text: `t${i}`, tsMs: i * 1000 });
const cand = (over: Partial<ScoredMeetingCandidate>): ScoredMeetingCandidate =>
  ({ title: 'T', decision: 'd', score: 0.8, decisionSpans: [], rationaleSpans: [], ...over });

describe('chunkUtterances', () => {
  it('splits into fixed-size chunks preserving global idx', () => {
    const chunks = chunkUtterances([idx(10), idx(11), idx(12), idx(13), idx(14)], 2);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunks[2]![0]!.idx).toBe(14); // idx carried, not re-based
  });
  it('empty input -> no chunks; size >= length -> single chunk', () => {
    expect(chunkUtterances([], 3)).toEqual([]);
    expect(chunkUtterances([idx(1), idx(2)], 9)).toHaveLength(1);
  });
});

describe('resolveSpans', () => {
  const byIdx = new Map<number, Utterance>([[12, utt(12)], [31, utt(31)]]);
  it('resolves decision + rationale spans to speaker/ts/text', () => {
    const spans = resolveSpans(cand({ decisionSpans: [31], rationaleSpans: [12] }), byIdx);
    expect(spans).toHaveLength(2);
    const d = spans.find((s) => s.kind === 'decision')!;
    expect(d.utteranceIdx).toBe(31);
    expect(d.tsMs).toBe(31000);
    expect(d.text).toBe('t31');
    expect(spans.find((s) => s.kind === 'rationale')!.utteranceIdx).toBe(12);
  });
  it('throws SpanIndexError on an out-of-range index (model hallucination -> error path)', () => {
    expect(() => resolveSpans(cand({ decisionSpans: [999] }), byIdx)).toThrow(SpanIndexError);
  });
});

describe('dedupeBySpanOverlap', () => {
  it('collapses candidates that share a decision-span index, keeping the higher score', () => {
    const a = cand({ title: 'Use Postgres', decisionSpans: [31], score: 0.7 });
    const b = cand({ title: 'Switch from SQLite to Postgres', decisionSpans: [31], score: 0.9 });
    const out = dedupeBySpanOverlap([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Switch from SQLite to Postgres'); // higher score kept
  });
  it('falls back to normalized-title match when spans do not overlap', () => {
    const a = cand({ title: 'Adopt  Postgres', decisionSpans: [10], score: 0.8 });
    const b = cand({ title: 'adopt postgres', decisionSpans: [20], score: 0.6 });
    expect(dedupeBySpanOverlap([a, b])).toHaveLength(1);
  });
  it('keeps genuinely distinct decisions', () => {
    const a = cand({ title: 'Postgres', decisionSpans: [10] });
    const b = cand({ title: 'Use Tailwind', decisionSpans: [20] });
    expect(dedupeBySpanOverlap([a, b])).toHaveLength(2);
  });
});
