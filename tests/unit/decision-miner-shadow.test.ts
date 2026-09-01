import { describe, it, expect } from 'vitest';
import { scoreHistogram, suggestionsPerWeek } from '@falcon/evals';

describe('shadow summarizers', () => {
  it('scoreHistogram buckets by 0.1', () => {
    const h = scoreHistogram([0.05, 0.12, 0.19, 0.91]);
    expect(h['0.0']).toBe(1);
    expect(h['0.1']).toBe(2);
    expect(h['0.9']).toBe(1);
  });

  it('scoreHistogram clamps out-of-range scores into the 0.0/0.9 edge buckets', () => {
    const h = scoreHistogram([-0.5, 1, 1.5]);
    expect(h['0.0']).toBe(1);
    expect(h['0.9']).toBe(2);
  });

  it('suggestionsPerWeek projects counts over a span', () => {
    // 4 above-threshold over 14 days → 2.0/week
    expect(suggestionsPerWeek(4, 14)).toBeCloseTo(2.0);
  });

  it('suggestionsPerWeek is 0 for a non-positive span', () => {
    expect(suggestionsPerWeek(4, 0)).toBe(0);
  });
});
