// Task C6 — handleMeetingExtract integration test. Ties the whole pipeline together: ledger gate →
// load working copy → budget gate → chunk+extract → threshold+dedup → rationale pass (top-N) →
// resolve+create records → retention → ledger record. Docker required (real Postgres + RLS).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema, createDb } from '@falcon/db';
import {
  createMeeting, persistWorkingCopy, getMinedMeeting, readWorkingCopy, type CoreDeps,
} from '@falcon/core';
import { handleMeetingExtract } from '../../apps/worker/src/handlers.js';
import { startTestDb, type TestDb } from '../support/pg.js';

const WS_A = '00000000-0000-0000-0000-0000000000aa';

let tdb: TestDb;
let deps: CoreDeps;

// Fake LLM: 'meeting_mine' -> a decision citing spans [31] (decision) + [12] (rationale);
//           'meeting_rationale' -> an extra rationale index [5].
function fakeDeps(dbUrl: string): CoreDeps {
  return {
    db: createDb(dbUrl),
    llm: {
      chat: {
        model: 'test',
        complete: async ({ meta }: any) => {
          if (meta?.name === 'meeting_rationale') return { text: '{"rationaleSpans":[5]}', usage: { inputTokens: 0, outputTokens: 0 } };
          return { text: '{"candidates":[{"title":"Use Postgres","decision":"Adopt Postgres over SQLite","rationale":"concurrency","decisionSpans":[31],"rationaleSpans":[12],"score":0.95}]}', usage: { inputTokens: 0, outputTokens: 0 } };
        },
      },
      embeddings: { model: 'e', embed: async (xs: string[]) => xs.map(() => new Array(1024).fill(0)) },
    } as unknown as CoreDeps['llm'],
  };
}

const UTTS = [
  { idx: 5, speaker: 'Guru', userId: 'u1', text: 'sqlite is simplest', tsMs: 500 },
  { idx: 12, speaker: 'Guru', userId: 'u1', text: 'the concurrency thing kills sqlite', tsMs: 1000 },
  { idx: 31, speaker: 'Sarah', userId: 'u2', text: 'okay, postgres then', tsMs: 240000 },
];

beforeAll(async () => {
  tdb = await startTestDb();
  deps = fakeDeps(tdb.appUrl);
  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
}, 180_000);

afterAll(async () => {
  await deps.db.client.end();
  await tdb.stop();
});

it('extracts a meeting decision with spans, records ledger=suggested, deletes working copy (retention off)', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [{ userId: 'u1', displayName: 'Guru', isMember: true, isFalconUser: true }] });
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, new Date(Date.now() + 48 * 3600_000));

  const out = await handleMeetingExtract(deps, { workspaceId: WS_A, meetingId });
  expect(out.result).toBe('suggested');
  expect(out.decisionIds).toHaveLength(1);

  const rec = await deps.db.withTenant(WS_A, async (tx) =>
    (await tx.select().from(schema.decisionRecord).where(eq(schema.decisionRecord.id, out.decisionIds[0]!)).limit(1))[0]);
  expect(rec!.origin).toBe('meeting');
  expect(rec!.sourceRef).toBe(`meeting:${meetingId}`);
  expect(rec!.visibility).toBe('workspace');
  expect(rec!.status).toBe('unconfirmed'); // never auto-confirms (R23)

  const spans = await deps.db.withTenant(WS_A, async (tx) =>
    tx.select().from(schema.decisionSpan).where(eq(schema.decisionSpan.decisionId, out.decisionIds[0]!)));
  // decision [31] + rationale [12] + rationale-pass [5]
  expect(spans.length).toBeGreaterThanOrEqual(3);

  const ledger = await getMinedMeeting(deps, WS_A, meetingId);
  expect(ledger!.result).toBe('suggested');
  expect(await readWorkingCopy(deps, WS_A, meetingId)).toBeNull(); // retention OFF -> deleted
});

it('ledger gate: a second run at the same extractor version is a no-op', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [] });
  await persistWorkingCopy(deps, WS_A, meetingId, UTTS, new Date(Date.now() + 48 * 3600_000));
  const first = await handleMeetingExtract(deps, { workspaceId: WS_A, meetingId });
  const second = await handleMeetingExtract(deps, { workspaceId: WS_A, meetingId });
  expect(second.decisionIds).toHaveLength(0);
  expect(second.result).toBe(first.result);
});

it('empty/discarded transcript -> no_decision ledger row, no records', async () => {
  const { meetingId } = await createMeeting(deps, WS_A, { sessionId: randomUUID(), attendees: [] });
  // no working copy persisted
  const out = await handleMeetingExtract(deps, { workspaceId: WS_A, meetingId });
  expect(out.result).toBe('no_decision');
  expect(out.decisionIds).toHaveLength(0);
  expect((await getMinedMeeting(deps, WS_A, meetingId))!.result).toBe('no_decision');
});
