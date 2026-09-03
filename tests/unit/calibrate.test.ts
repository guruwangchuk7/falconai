import { describe, it, expect } from 'vitest';
import { sweepThresholds, titlesMatch, type ExtractedMeeting } from '@falcon/core';

// Deterministic corpus — no model, no DB. Proves the precision/recall/F1 sweep is correct so the harness
// can be trusted the moment a real labeled corpus lands.
const meetings: ExtractedMeeting[] = [
  { id: 'A', gold: [{ title: 'Use Postgres' }], candidates: [{ title: 'Use Postgres', score: 0.9 }] },      // clear decision
  { id: 'B', gold: [], candidates: [{ title: 'Adopt Bun', score: 0.6 }] },                                   // NO decision, one spurious candidate
  { id: 'C', gold: [{ title: 'Adopt Sentry' }], candidates: [{ title: 'Adopt Sentry', score: 0.7 }] },       // borderline-scored decision
];

const rowAt = (t: number, r = sweepThresholds(meetings, [0.5, 0.65, 0.75, 0.95])) => r.rows.find((x) => x.threshold === t)!;

describe('sweepThresholds', () => {
  it('t=0.65 captures both real decisions and excludes the spurious one → perfect', () => {
    const r = rowAt(0.65);
    expect([r.tp, r.fp, r.fn]).toEqual([2, 0, 0]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('t=0.5 lets the no-decision meeting’s candidate through → a false positive, precision drops', () => {
    const r = rowAt(0.5);
    expect([r.tp, r.fp, r.fn]).toEqual([2, 1, 0]);
    expect(r.precision).toBeCloseTo(2 / 3);
    expect(r.recall).toBe(1);
  });

  it('t=0.75 drops the borderline decision → a false negative, recall halves', () => {
    const r = rowAt(0.75);
    expect([r.tp, r.fp, r.fn]).toEqual([1, 0, 1]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0.5);
  });

  it('t=0.95 predicts nothing → all misses', () => {
    const r = rowAt(0.95);
    expect([r.tp, r.fp, r.fn]).toEqual([0, 0, 2]);
    expect(r.f1).toBe(0);
  });

  it('recommends the max-F1 threshold', () => {
    expect(sweepThresholds(meetings, [0.5, 0.65, 0.75, 0.95]).recommended).toBe(0.65);
  });
});

describe('titlesMatch', () => {
  it('matches on normalized token overlap, not exact string', () => {
    expect(titlesMatch('Use Postgres', 'use postgres')).toBe(true);
    expect(titlesMatch('Adopt Sentry for error tracking', 'Sentry for error tracking')).toBe(true);
    expect(titlesMatch('Use Postgres', 'Adopt Bun')).toBe(false);
  });
});
