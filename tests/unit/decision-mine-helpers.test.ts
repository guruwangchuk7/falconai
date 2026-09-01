import { describe, it, expect } from 'vitest';
import { contentHash, normalizeTitle, shouldMine } from '@falcon/core';

describe('mine helpers', () => {
  it('contentHash is stable and order-sensitive over segments', () => {
    const a = contentHash([{ speaker: 'x', text: 'hello' }]);
    expect(a).toBe(contentHash([{ speaker: 'x', text: 'hello' }]));
    expect(a).not.toBe(contentHash([{ speaker: 'x', text: 'hello world' }]));
  });
  it('contentHash is injective across segment boundaries', () => {
    expect(contentHash([{ speaker: 'a b', text: 'c' }])).not.toBe(
      contentHash([{ speaker: 'a', text: 'b' }, { speaker: null, text: 'c' }]),
    );
  });
  it('normalizeTitle folds case, whitespace, and trailing punctuation', () => {
    expect(normalizeTitle('  Use   Postgres. ')).toBe(normalizeTitle('use postgres'));
    expect(normalizeTitle('Adopt SQL!')).toBe('adopt sql');
  });
});

describe('shouldMine gate', () => {
  const wm = new Date('2026-01-01T00:00:00Z');
  it('mines a merged PR after the watermark', () => {
    expect(shouldMine({ type: 'pr', state: 'merged', mergedClosedAt: new Date('2026-02-01') }, wm)).toBe(true);
  });
  it('skips a merged PR before the watermark (backfill guard)', () => {
    expect(shouldMine({ type: 'pr', state: 'merged', mergedClosedAt: new Date('2025-12-01') }, wm)).toBe(false);
  });
  it('skips open PRs, closed-unmerged, comments', () => {
    expect(shouldMine({ type: 'pr', state: 'open', mergedClosedAt: null }, wm)).toBe(false);
    expect(shouldMine({ type: 'pr', state: 'closed', mergedClosedAt: new Date('2026-02-01') }, wm)).toBe(false);
    expect(shouldMine({ type: 'review_comment', state: null, mergedClosedAt: new Date('2026-02-01') }, wm)).toBe(false);
  });
  it('mines a completed Linear issue', () => {
    expect(shouldMine({ type: 'issue', state: 'completed', mergedClosedAt: new Date('2026-02-01') }, wm)).toBe(true);
  });
});
