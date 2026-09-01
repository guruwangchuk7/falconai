import { describe, it, expect } from 'vitest';
import { extractDecisions, EXTRACTOR_VERSION, type ScoredCandidate } from '@falcon/core';
import type { CoreDeps } from '@falcon/core';

// Fake chat provider that returns a scripted JSON string.
const depsWith = (json: string): CoreDeps => ({
  db: {} as any,
  llm: {
    chat: { model: 'test-model', complete: async () => ({ text: json, usage: { inputTokens: 0, outputTokens: 0 } }) },
    embeddings: {} as any, rerank: {} as any,
  } as any,
});
const seg = (text: string) => ({ segments: [{ speaker: 'alice', text }], sourceRef: '#1' });

describe('extractDecisions', () => {
  it('returns a candidate for a clear decision', async () => {
    const deps = depsWith('{"candidates":[{"title":"Adopt SQL","decision":"Use Postgres","score":0.9}]}');
    const out = await extractDecisions(deps, seg('We decided to use Postgres over Mongo.'));
    expect(out).toHaveLength(1);
    expect(out[0]!.decision).toBe('Use Postgres');
    expect(out[0]!.score).toBe(0.9);
  });

  it('returns [] when the model reports no decision', async () => {
    const deps = depsWith('{"candidates":[]}');
    expect(await extractDecisions(deps, seg('Fixed a typo in the readme.'))).toEqual([]);
  });

  it('returns TWO candidates from one window (meeting-listener path)', async () => {
    const deps = depsWith('{"candidates":[{"title":"A","decision":"a","score":0.8},{"title":"B","decision":"b","score":0.7}]}');
    expect(await extractDecisions(deps, seg('two decisions'))).toHaveLength(2);
  });

  it('returns [] after one failed re-parse of malformed JSON', async () => {
    const deps = depsWith('not json at all');
    expect(await extractDecisions(deps, seg('x'))).toEqual([]);
  });

  it('drops candidates missing a decision string (defensive)', async () => {
    const deps = depsWith('{"candidates":[{"title":"no decision field","score":0.9}]}');
    expect(await extractDecisions(deps, seg('x'))).toEqual([]);
  });

  it('EXTRACTOR_VERSION is a stable non-empty hash', () => {
    expect(typeof EXTRACTOR_VERSION).toBe('string');
    expect(EXTRACTOR_VERSION.length).toBeGreaterThan(7);
  });
});
