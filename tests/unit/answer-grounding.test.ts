import { describe, it, expect } from 'vitest';
import { parseClaims, groundClaims, parseTimeWindow } from '@falcon/core';
import type { RetrievedItem } from '@falcon/core';

describe('parseTimeWindow', () => {
  const now = new Date('2026-08-29T10:00:00.000Z');
  it('today → from midnight UTC to now', () => {
    expect(parseTimeWindow('what did I do today?', now)).toEqual({
      since: '2026-08-29T00:00:00.000Z', until: '2026-08-29T10:00:00.000Z',
    });
  });
  it('yesterday → the prior UTC day', () => {
    expect(parseTimeWindow('anything from yesterday?', now)).toEqual({
      since: '2026-08-28T00:00:00.000Z', until: '2026-08-29T00:00:00.000Z',
    });
  });
  it('this week → rolling 7 days', () => {
    expect(parseTimeWindow('what did I finish this week', now).since).toBe('2026-08-22T10:00:00.000Z');
  });
  it('last month → rolling 30 days', () => {
    expect(parseTimeWindow('summarize last month', now).since).toBe('2026-07-30T10:00:00.000Z');
  });
  it('no time phrase → empty window', () => {
    expect(parseTimeWindow('what did I do for authentication?', now)).toEqual({});
  });
});

// Pure grounding-gate tests (Constitution II / spec 002-personal-falcon T008). No DB/LLM.

const item = (i: number): RetrievedItem => ({
  artifactId: `art-${i}`,
  type: 'commit',
  externalRef: `sha${i}`,
  title: `t${i}`,
  snippet: `s${i}`,
  score: 0.1,
  trustTier: 'trusted',
  lastSyncedAt: `2026-08-2${i}T00:00:00.000Z`,
  isStale: false,
});

describe('parseClaims', () => {
  it('parses strict JSON', () => {
    expect(parseClaims('{"claims":[{"text":"a","citations":[1]}]}')).toEqual([{ text: 'a', citations: [1] }]);
  });
  it('extracts JSON embedded in prose/fences', () => {
    expect(parseClaims('here you go:\n```json\n{"claims":[{"text":"a","citations":[2]}]}\n```')).toEqual([
      { text: 'a', citations: [2] },
    ]);
  });
  it('returns null on unparseable text (→ no grounded answer, never raw text)', () => {
    expect(parseClaims('I think you did some auth work, probably.')).toBeNull();
  });
  it('returns null when claims key is missing', () => {
    expect(parseClaims('{"foo":1}')).toBeNull();
  });
});

describe('groundClaims (verify-then-drop)', () => {
  const items = [item(1), item(2), item(3)];

  it('keeps claims whose citations map to retrieved candidates', () => {
    const { claims } = groundClaims([{ text: 'did X', citations: [1, 2] }], items);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.citations.map((c) => c.artifactId)).toEqual(['art-1', 'art-2']);
  });

  it('drops citations not in the retrieved set (out-of-range candidate number)', () => {
    const { claims } = groundClaims([{ text: 'did X', citations: [1, 99] }], items);
    expect(claims[0]!.citations.map((c) => c.artifactId)).toEqual(['art-1']); // 99 dropped
  });

  it('drops a claim entirely when NO citation is valid (ungrounded → silent)', () => {
    const { claims } = groundClaims([{ text: 'hallucinated', citations: [99] }], items);
    expect(claims).toHaveLength(0);
  });

  it('drops a claim with empty text even if cited', () => {
    const { claims } = groundClaims([{ text: '   ', citations: [1] }], items);
    expect(claims).toHaveLength(0);
  });

  it('reports cited sync timestamps for freshness', () => {
    const { citedIso } = groundClaims([{ text: 'a', citations: [1, 3] }], items);
    expect(citedIso.sort().at(-1)).toBe('2026-08-23T00:00:00.000Z');
  });
});
