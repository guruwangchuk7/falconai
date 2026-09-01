import { describe, it, expect } from 'vitest';
import { contentHash, normalizeTitle } from '@falcon/core';

describe('mine helpers', () => {
  it('contentHash is stable and order-sensitive over segments', () => {
    const a = contentHash([{ speaker: 'x', text: 'hello' }]);
    expect(a).toBe(contentHash([{ speaker: 'x', text: 'hello' }]));
    expect(a).not.toBe(contentHash([{ speaker: 'x', text: 'hello world' }]));
  });
  it('normalizeTitle folds case, whitespace, and trailing punctuation', () => {
    expect(normalizeTitle('  Use   Postgres. ')).toBe(normalizeTitle('use postgres'));
    expect(normalizeTitle('Adopt SQL!')).toBe('adopt sql');
  });
});
