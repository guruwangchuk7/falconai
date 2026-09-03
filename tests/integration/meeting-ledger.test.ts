// Feature 005 (Decision Memory) — meeting mine-once ledger. Mirrors the Ship 2 `mined_artifact`
// ledger but keyed on meetingId (no contentHash — a finalized transcript is immutable) + reserved
// budget lane (D11). Docker required.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type DbHandle } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';
import {
  getMinedMeeting, recordMinedMeeting, countMeetingSuggestionsToday, createDecision,
  type CoreDeps,
} from '@falcon/core';
import { startTestDb, type TestDb } from '../support/pg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const M2 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');

const WS_A = '00000000-0000-0000-0000-0000000000aa';
const WS_B = '00000000-0000-0000-0000-0000000000bb';
const M1 = '33333333-3333-3333-3333-333333333333';

let tdb: TestDb;
let db: DbHandle;
let cannedAnswer = '{"claims":[]}';

const llm: LlmProviders = {
  chat: { model: 'test-model', complete: async () => ({ text: cannedAnswer, usage: { inputTokens: 0, outputTokens: 0 } }) },
  embeddings: { model: EMBEDDING_MODEL, version: EMBEDDING_VERSION, dim: 1024, embed: async (texts: string[]) => texts.map(() => Array(1024).fill(0.1)) },
  rerank: { model: 'r', rerank: async () => [] },
} as unknown as LlmProviders;

let deps: CoreDeps;

beforeAll(async () => {
  tdb = await startTestDb();
  await tdb.admin.unsafe(readFileSync(M2, 'utf8'));
  db = createDb(tdb.appUrl);
  deps = { db, llm };
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_B, name: 'B', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await db.client.end();
  await tdb.stop();
});

it('records and reads a mine-once ledger row (no contentHash)', async () => {
  expect(await getMinedMeeting(deps, WS_A, M1)).toBeNull();
  await recordMinedMeeting(deps, WS_A, M1, { result: 'suggested', extractorVersion: 'v1', transcriptRetainedUntil: null, decisionId: null, maxCandidateScore: 0.9 });
  const row = await getMinedMeeting(deps, WS_A, M1);
  expect(row!.result).toBe('suggested');
  expect(row!.extractorVersion).toBe('v1');
});

it('upserts on (workspace, meeting) — re-mining overwrites, not duplicates', async () => {
  await recordMinedMeeting(deps, WS_A, M1, { result: 'no_decision', extractorVersion: 'v2' });
  const row = await getMinedMeeting(deps, WS_A, M1);
  expect(row!.result).toBe('no_decision');
  expect(row!.extractorVersion).toBe('v2');
});

it('is tenant-isolated: WS_B cannot see WS_A ledger rows', async () => {
  expect(await getMinedMeeting(deps, WS_B, M1)).toBeNull();
});

it('countMeetingSuggestionsToday counts only origin=meeting records from today', async () => {
  const before = await countMeetingSuggestionsToday(deps, WS_A);
  await createDecision(deps, WS_A, { title: 'M', decision: 'd', origin: 'meeting', sourceRef: 'meeting:x' });
  await createDecision(deps, WS_A, { title: 'PR', decision: 'd', origin: 'suggested', sourceRef: 'pr:x' }); // not counted
  expect(await countMeetingSuggestionsToday(deps, WS_A)).toBe(before + 1);
});
