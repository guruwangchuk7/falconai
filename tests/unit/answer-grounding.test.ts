import { describe, it, expect } from 'vitest';
import { parseClaims, groundClaims, parseTimeWindow, citationUrl, claimTier, emptyAnswerMessage } from '@falcon/core';
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
  it('last 3 months → rolling 90 days (Tester #1 exact query)', () => {
    // now - 90d. Was previously UNPARSED → silently no date filter → the skeptic-losing truncation.
    expect(parseTimeWindow('what did I change in authentication over the last 3 months?', now).since)
      .toBe('2026-05-31T10:00:00.000Z');
  });
  it('past quarter → rolling 90 days', () => {
    expect(parseTimeWindow('decisions from the past quarter', now).since).toBe('2026-05-31T10:00:00.000Z');
  });
  it('last 2 weeks → rolling 14 days', () => {
    expect(parseTimeWindow('what shipped in the last 2 weeks', now).since).toBe('2026-08-15T10:00:00.000Z');
  });
  it('last 10 days → rolling 10 days', () => {
    expect(parseTimeWindow('anything in the last 10 days', now).since).toBe('2026-08-19T10:00:00.000Z');
  });
  it('a multi-month phrase takes precedence over the bare "month" branch', () => {
    // "last 6 months" must NOT collapse to the 30-day "month" rule.
    expect(parseTimeWindow('the last 6 months of work', now).since).toBe('2026-03-02T10:00:00.000Z');
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
  source: 'github',
  repoOrProject: `owner/repo${i}`,
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

  it('attaches an openable citation URL when the source resolves', () => {
    const { claims } = groundClaims([{ text: 'did X', citations: [1] }], items);
    expect(claims[0]!.citations[0]!.url).toBe('https://github.com/owner/repo1/commit/sha1');
  });

  // Feature 005 US1 (T019): a confirmed-decision citation links to its detail view, and the chip
  // label uses the decision title rather than the bare "decision" externalRef.
  it('links a decision citation to its detail view and labels it by title', () => {
    const decisionItem: RetrievedItem = {
      artifactId: 'dec-7', type: 'decision', externalRef: 'decision', title: 'Adopt Deepgram',
      source: 'decision', repoOrProject: null, snippet: 'we chose deepgram', score: 0.1,
      trustTier: 'trusted', lastSyncedAt: '2026-08-29T00:00:00.000Z', isStale: false,
    };
    const { claims } = groundClaims([{ text: 'we chose Deepgram', citations: [1] }], [decisionItem]);
    expect(claims[0]!.citations[0]!.url).toBe('/decisions/dec-7');
    expect(claims[0]!.citations[0]!.externalRef).toBe('Adopt Deepgram');
    expect(claims[0]!.tier).toBe('confirmed'); // decision-grounded → Confirmed badge
  });

  it('propagates trustTier onto citations and tags a comment-only claim "from_comment"', () => {
    const comment: RetrievedItem = { ...item(1), type: 'review_comment', trustTier: 'untrusted' };
    const { claims } = groundClaims([{ text: 'someone said X', citations: [1] }], [comment]);
    expect(claims[0]!.citations[0]!.trustTier).toBe('untrusted');
    expect(claims[0]!.tier).toBe('from_comment');
  });

  it('leaves a plain trusted-PR claim un-badged (no noise)', () => {
    const { claims } = groundClaims([{ text: 'did X', citations: [1] }], [item(1)]);
    expect(claims[0]!.tier).toBeUndefined();
  });
});

describe('claimTier (provenance-strength, deterministic — never a model score)', () => {
  const cite = (type: string, trustTier: string) => ({ type, trustTier });
  it('confirmed when any citation is a (confirmed) decision — even mixed with a comment', () => {
    expect(claimTier([cite('decision', 'trusted'), cite('review_comment', 'untrusted')])).toBe('confirmed');
  });
  it('from_comment only when EVERY citation is untrusted', () => {
    expect(claimTier([cite('review_comment', 'untrusted'), cite('review_comment', 'untrusted')])).toBe('from_comment');
  });
  it('no badge when a trusted source is present alongside a comment', () => {
    expect(claimTier([cite('pr', 'trusted'), cite('review_comment', 'untrusted')])).toBeNull();
  });
  it('no badge for a plain trusted PR/commit', () => {
    expect(claimTier([cite('pr', 'trusted')])).toBeNull();
  });
  it('null for no citations', () => {
    expect(claimTier([])).toBeNull();
  });
});

describe('emptyAnswerMessage (honest "nothing found" — names what was searched)', () => {
  it('names no sources + prompts to connect when nothing is connected', () => {
    const m = emptyAnswerMessage([]);
    expect(m).toMatch(/no work sources are connected/i);
    expect(m).toMatch(/Integrations/);
  });
  it('names a single connected source with a friendly label', () => {
    expect(emptyAnswerMessage(['github'])).toBe(
      'I searched your GitHub and your decisions, but found nothing that grounds an answer to this.',
    );
  });
  it('lists two sources with "and"', () => {
    expect(emptyAnswerMessage(['github', 'linear'])).toContain('GitHub and Linear');
  });
  it('lists three sources with commas + a final "and"', () => {
    expect(emptyAnswerMessage(['github', 'linear', 'jira'])).toContain('GitHub, Linear and Jira');
  });
  it('dedupes repeated providers', () => {
    expect(emptyAnswerMessage(['github', 'github'])).toContain('your GitHub and your decisions');
  });
});

describe('citationUrl', () => {
  it('builds a GitHub commit URL', () => {
    expect(citationUrl({ source: 'github', repoOrProject: 'o/r', type: 'commit', externalRef: 'abc123' }))
      .toBe('https://github.com/o/r/commit/abc123');
  });
  it('builds a GitHub PR URL and strips the leading #', () => {
    expect(citationUrl({ source: 'github', repoOrProject: 'o/r', type: 'pr', externalRef: '#482' }))
      .toBe('https://github.com/o/r/pull/482');
  });
  it('falls back to the repo root for other GitHub types', () => {
    expect(citationUrl({ source: 'github', repoOrProject: 'o/r', type: 'review_comment', externalRef: 'rc-9' }))
      .toBe('https://github.com/o/r');
  });
  it('returns null when the source has no resolvable URL', () => {
    expect(citationUrl({ source: 'jira', repoOrProject: 'PROJ', type: 'issue', externalRef: 'PROJ-1' })).toBeNull();
    expect(citationUrl({ source: 'github', repoOrProject: null, type: 'commit', externalRef: 'x' })).toBeNull();
  });
});
