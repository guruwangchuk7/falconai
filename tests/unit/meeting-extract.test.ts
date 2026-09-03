import { describe, it, expect } from 'vitest';
import { extractMeetingDecisions, MEETING_EXTRACTOR_VERSION, type IndexedUtterance } from '@falcon/core';
import type { CoreDeps } from '@falcon/core';

const depsWith = (json: string): CoreDeps => ({
  db: {} as CoreDeps['db'],
  llm: {
    chat: { model: 'test-model', complete: async () => ({ text: json, usage: { inputTokens: 0, outputTokens: 0 } }) },
    embeddings: { model: 'test-embed', embed: async () => [[0]] },
  } as unknown as CoreDeps['llm'],
});
const utts: IndexedUtterance[] = [
  { idx: 12, speaker: 'Guru', text: 'the concurrency thing kills sqlite' },
  { idx: 31, speaker: 'Sarah', text: 'okay, postgres then' },
];
const input = { utterances: utts, sourceRef: 'meeting:m1' };

it('parses candidates WITH decision/rationale span indices', async () => {
  const deps = depsWith('{"candidates":[{"title":"Use Postgres","decision":"Adopt Postgres over SQLite","rationale":"concurrency","decisionSpans":[31],"rationaleSpans":[12],"score":0.9}]}');
  const out = await extractMeetingDecisions(deps, input);
  expect(out).toHaveLength(1);
  expect(out[0]!.decisionSpans).toEqual([31]);
  expect(out[0]!.rationaleSpans).toEqual([12]);
  expect(out[0]!.score).toBeCloseTo(0.9);
});

// Regression (found in the live feel-pass, 2026-09-03): Haiku 4.5 wraps its reply in a ```json code
// fence despite "reply with ONLY JSON", which made a bare JSON.parse throw → every live meeting
// extraction silently returned []. The parser must slice the JSON object out of fenced/prose replies.
it('parses candidates wrapped in a ```json markdown code fence', async () => {
  const fenced = '```json\n{"candidates":[{"title":"Use Postgres","decision":"Adopt Postgres over SQLite","decisionSpans":[31],"rationaleSpans":[12],"score":0.95}]}\n```';
  const out = await extractMeetingDecisions(depsWith(fenced), input);
  expect(out).toHaveLength(1);
  expect(out[0]!.decisionSpans).toEqual([31]);
  expect(out[0]!.score).toBeCloseTo(0.95);
});

it('parses candidates when the model adds surrounding prose', async () => {
  const chatty = 'Here is the decision I found:\n{"candidates":[{"title":"T","decision":"d","score":0.8}]}\nHope that helps!';
  const out = await extractMeetingDecisions(depsWith(chatty), input);
  expect(out).toHaveLength(1);
  expect(out[0]!.title).toBe('T');
});

it('defaults missing span arrays to [] and coerces to integers', async () => {
  const deps = depsWith('{"candidates":[{"title":"T","decision":"d","score":0.8}]}');
  const out = await extractMeetingDecisions(deps, input);
  expect(out[0]!.decisionSpans).toEqual([]);
  expect(out[0]!.rationaleSpans).toEqual([]);
});

it('drops malformed candidates (missing title/decision/score)', async () => {
  const deps = depsWith('{"candidates":[{"title":"no decision","score":0.9}]}');
  expect(await extractMeetingDecisions(deps, input)).toEqual([]);
});

it('returns [] on non-JSON (after the one re-call)', async () => {
  expect(await extractMeetingDecisions(depsWith('not json'), input)).toEqual([]);
});

it('threads ownerHint onto every candidate', async () => {
  const deps = depsWith('{"candidates":[{"title":"T","decision":"d","decisionSpans":[31],"score":0.7}]}');
  const out = await extractMeetingDecisions(deps, { ...input, ownerHint: 'u-guru' });
  expect(out[0]!.ownerHint).toBe('u-guru');
});

it('MEETING_EXTRACTOR_VERSION is a stable non-empty hash, distinct from PR extractor', async () => {
  expect(MEETING_EXTRACTOR_VERSION).toMatch(/^[0-9a-f]{16}$/);
});
