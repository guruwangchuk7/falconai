import { it, expect } from 'vitest';
import { extractCommitments, COMMITMENT_EXTRACTOR_VERSION, type IndexedUtterance } from '@falcon/core';
import type { CoreDeps } from '@falcon/core';

const depsWith = (json: string): CoreDeps => ({
  db: {} as CoreDeps['db'],
  llm: {
    chat: { model: 'test-model', complete: async () => ({ text: json, usage: { inputTokens: 0, outputTokens: 0 } }) },
    embeddings: { model: 'test-embed', embed: async () => [[0]] },
  } as unknown as CoreDeps['llm'],
});

const utts: IndexedUtterance[] = [
  { idx: 4, speaker: 'Guru', text: "I'll send Acme the revised mockups by Friday" },
  { idx: 9, speaker: 'Sarah', text: 'sounds good' },
];
const input = { utterances: utts, sourceRef: 'meeting:m1' };

it('parses a commitment with owner, counterparty, due, and spans', async () => {
  const deps = depsWith('{"commitments":[{"text":"Send Acme the revised mockups","owner":"Guru","counterparty":"Acme","due":"by Friday","spans":[4],"score":0.9}]}');
  const out = await extractCommitments(deps, input);
  expect(out).toHaveLength(1);
  expect(out[0]!.text).toBe('Send Acme the revised mockups');
  expect(out[0]!.ownerHint).toBe('Guru');
  expect(out[0]!.counterparty).toBe('Acme');
  expect(out[0]!.dueHint).toBe('by Friday');
  expect(out[0]!.spans).toEqual([4]);
  expect(out[0]!.score).toBeCloseTo(0.9);
});

// Same regression class as the meeting extractor: Haiku 4.5 wraps its reply in a ```json fence despite
// "reply with ONLY JSON", which a bare JSON.parse would throw on → every extraction silently returns [].
it('parses commitments wrapped in a ```json code fence', async () => {
  const fenced = '```json\n{"commitments":[{"text":"Ship SSO next sprint","owner":"Sarah","spans":[9],"score":0.8}]}\n```';
  const out = await extractCommitments(depsWith(fenced), input);
  expect(out).toHaveLength(1);
  expect(out[0]!.text).toBe('Ship SSO next sprint');
  expect(out[0]!.counterparty).toBeNull();
  expect(out[0]!.dueHint).toBeNull();
});

it('coerces missing optional fields to null and clamps score', async () => {
  const out = await extractCommitments(depsWith('{"commitments":[{"text":"do the thing","spans":[4],"score":1.5}]}'), input);
  expect(out[0]!.ownerHint).toBeNull();
  expect(out[0]!.score).toBe(1);
});

it('drops malformed rows (missing text or score)', async () => {
  const out = await extractCommitments(depsWith('{"commitments":[{"owner":"Guru","spans":[4],"score":0.9},{"text":"no score"}]}'), input);
  expect(out).toEqual([]);
});

it('returns [] on non-JSON (after the one re-call)', async () => {
  expect(await extractCommitments(depsWith('not json'), input)).toEqual([]);
});

it('COMMITMENT_EXTRACTOR_VERSION is a stable non-empty hash', () => {
  expect(COMMITMENT_EXTRACTOR_VERSION).toMatch(/^[0-9a-f]{16}$/);
});
