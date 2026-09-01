import { describe, it, expect } from 'vitest';
import { mapPullState } from '@falcon/integrations';

describe('mapPullState', () => {
  it('merged when merged_at present', () => {
    expect(mapPullState({ merged_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-01T00:00:00Z' })).toEqual({ state: 'merged', mergedClosedAt: '2026-01-01T00:00:00Z' });
  });
  it('closed (unmerged) when closed_at present but merged_at null', () => {
    expect(mapPullState({ merged_at: null, closed_at: '2026-02-02T00:00:00Z' })).toEqual({ state: 'closed', mergedClosedAt: '2026-02-02T00:00:00Z' });
  });
  it('open when neither', () => {
    expect(mapPullState({ merged_at: null, closed_at: null })).toEqual({ state: 'open', mergedClosedAt: null });
  });
});
