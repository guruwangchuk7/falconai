import { describe, it, expect } from 'vitest';
import { computeOmissionDiff, type OmittedArtifact } from '@falcon/core';

// F7.2 omission diff (shadow): flag top-N retrieved artifacts that a grounded answer did NOT cite —
// the injection-omission signal provenance-gating can't see. Pure function, no LLM/DB.
const item = (artifactId: string, title: string, trustTier = 'trusted') =>
  ({ artifactId, type: 'commit', externalRef: 'x', source: 'github', repoOrProject: null, title, snippet: '', score: 0, trustTier, lastSyncedAt: '2026-09-03T00:00:00Z', isStale: false }) as any;

const ids = (o: OmittedArtifact[]) => o.map((x) => x.artifactId);

describe('computeOmissionDiff', () => {
  const ranked = [item('a', 'top'), item('b', 'second'), item('c', 'third'), item('d', 'fourth')];

  it('returns [] when every top-N artifact was cited', () => {
    expect(computeOmissionDiff(ranked, new Set(['a', 'b', 'c']), 3)).toEqual([]);
  });

  it('flags a top-ranked retrieved artifact the answer dropped (with its rank)', () => {
    const out = computeOmissionDiff(ranked, new Set(['b', 'c']), 3); // 'a' (rank 1) uncited
    expect(ids(out)).toEqual(['a']);
    expect(out[0]!.rank).toBe(1);
  });

  it('flags multiple omissions among the top-N', () => {
    expect(ids(computeOmissionDiff(ranked, new Set(['c']), 3))).toEqual(['a', 'b']);
  });

  it('only inspects the top-N — a dropped rank-4 artifact is NOT flagged', () => {
    expect(computeOmissionDiff(ranked, new Set(['a', 'b', 'c']), 3)).toEqual([]); // 'd' uncited but rank 4
  });

  it('carries the trust tier through (an untrusted omitted artifact is the interesting case)', () => {
    const poisoned = [item('p', 'PR comment body', 'untrusted'), item('a', 'real', 'trusted')];
    const out = computeOmissionDiff(poisoned, new Set(['a']), 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.trustTier).toBe('untrusted');
  });
});
