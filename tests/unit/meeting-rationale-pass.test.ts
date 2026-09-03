import { it, expect } from 'vitest';
import { rationalePass, type IndexedUtterance } from '@falcon/core';
import type { CoreDeps } from '@falcon/core';

const depsWith = (json: string): CoreDeps => ({
  db: {} as CoreDeps['db'],
  llm: { chat: { model: 'test', complete: async () => ({ text: json, usage: { inputTokens: 0, outputTokens: 0 } }) },
         embeddings: { model: 'e', embed: async () => [[0]] } } as unknown as CoreDeps['llm'],
});
const full: IndexedUtterance[] = [
  { idx: 12, speaker: 'Guru', text: 'the concurrency thing kills sqlite' },
  { idx: 31, speaker: 'Sarah', text: 'okay, postgres then' },
];
const dec = { title: 'Use Postgres', decision: 'Adopt Postgres over SQLite' };

it('returns rationale indices that exist in the transcript', async () => {
  const r = await rationalePass(depsWith('{"rationaleSpans":[12]}'), dec, full, 'meeting:m1');
  expect(r).toEqual([12]);
});
it('filters out hallucinated (non-existent) indices so a bad pass cannot invalidate the decision', async () => {
  const r = await rationalePass(depsWith('{"rationaleSpans":[12,999]}'), dec, full, 'meeting:m1');
  expect(r).toEqual([12]);
});
it('returns [] on non-JSON', async () => {
  expect(await rationalePass(depsWith('nope'), dec, full, 'meeting:m1')).toEqual([]);
});
