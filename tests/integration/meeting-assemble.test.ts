// Task B3 (feature 005, In-Meeting Decision Listener) — session->workspace resolver (0007) + the
// session-end assembly step: resolve workspace (RLS bootstrap via SECURITY DEFINER), snapshot
// attendees, assemble the finalized transcript from the Redis event log into a durable Postgres
// working copy (D7), and enqueue the meeting-extract job exactly once. Idempotent per session.
// Runs against real Postgres (RLS-enforcing falcon_app role) and real Redis (Testcontainers).
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { createDb, schema, type DbHandle } from '@falcon/db';
import { createEventLog } from '@falcon/session-core';
import {
  resolveSessionWorkspace, getMeetingBySession, readWorkingCopy, getMeeting,
  type CoreDeps,
} from '@falcon/core';
import type { MeetingExtractJob } from '@falcon/queue';
import { assembleAndEnqueue } from '../../apps/session-worker/src/meeting-end.js';
import { startTestDb, type TestDb } from '../support/pg.js';
import { startTestRedis, type TestRedis } from '../support/redis.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0002 = resolve(HERE, '../../packages/db/drizzle/0002_personal_falcon.sql');
const MIGRATION_0003 = resolve(HERE, '../../packages/db/drizzle/0003_pairing.sql');

const WS_A = randomUUID();
const U1 = randomUUID();
const U2 = randomUUID();

let tdb: TestDb;
let tr: TestRedis;
let db: DbHandle;
let redis: Redis;
let deps: CoreDeps;
let S1: string;

beforeAll(async () => {
  tdb = await startTestDb();
  // startTestDb does NOT include session/session_membership (those live in 0003) — apply 0002 then
  // 0003 ourselves, mirroring pairing-rls.test.ts.
  await tdb.admin.unsafe(readFileSync(MIGRATION_0002, 'utf8'));
  await tdb.admin.unsafe(readFileSync(MIGRATION_0003, 'utf8'));
  db = createDb(tdb.appUrl);
  deps = { db, llm: {} as CoreDeps['llm'] };

  tr = await startTestRedis();
  redis = new Redis(tr.url, { maxRetriesPerRequest: null });

  await tdb.admin`insert into workspace ${tdb.admin({ id: WS_A, name: 'A', settings: {} }, 'id', 'name', 'settings')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: U1, email: 'u1@x.com', name: 'Uno' }, 'id', 'email', 'name')}`;
  await tdb.admin`insert into "user" ${tdb.admin({ id: U2, email: 'u2@x.com', name: 'Duo' }, 'id', 'email', 'name')}`;

  await db.withTenant(WS_A, (tx) => tx.insert(schema.membership).values({ userId: U1, workspaceId: WS_A, role: 'engineer' }));
  await db.withTenant(WS_A, (tx) => tx.insert(schema.membership).values({ userId: U2, workspaceId: WS_A, role: 'engineer' }));

  const [row] = await db.withTenant(WS_A, (tx) =>
    tx.insert(schema.session).values({ workspaceId: WS_A, sessionKey: 'standup', origin: 'code' }).returning({ id: schema.session.id }),
  );
  S1 = row!.id;
  await db.withTenant(WS_A, (tx) =>
    tx.insert(schema.sessionMembership).values({ workspaceId: WS_A, sessionId: S1, userId: U1, joinOrigin: 'code' }),
  );
  await db.withTenant(WS_A, (tx) =>
    tx.insert(schema.sessionMembership).values({ workspaceId: WS_A, sessionId: S1, userId: U2, joinOrigin: 'code' }),
  );
}, 180_000);

afterAll(async () => {
  redis.disconnect();
  await tr.stop();
  await db.client.end();
  await tdb.stop();
});

it('resolveSessionWorkspace returns the workspace for a session, bypassing RLS bootstrap', async () => {
  expect(await resolveSessionWorkspace(deps, S1)).toBe(WS_A);
  expect(await resolveSessionWorkspace(deps, randomUUID())).toBeNull();
});

it('assembles utterances, snapshots attendees, persists a working copy, enqueues once', async () => {
  const log = createEventLog(redis, S1);
  await log.append('utterance_final', { userId: U1, clientSeq: 1, text: 'the concurrency thing kills sqlite', arrivalTs: 1000, errorMarginMs: 250 });
  await log.append('utterance_final', { userId: U2, clientSeq: 1, text: 'okay, postgres then', arrivalTs: 240000, errorMarginMs: 250 });
  await log.append('utterance_final', { userId: U2, clientSeq: 2, text: '', arrivalTs: 240500, errorMarginMs: 250 }); // empty -> skipped

  const enqueued: Array<{ job: MeetingExtractJob; jobId: string }> = [];
  const res = await assembleAndEnqueue(deps, redis, S1, async (job, jobId) => { enqueued.push({ job, jobId }); });
  expect(res).not.toBeNull();
  const { meetingId } = res!;

  const m = await getMeeting(deps, WS_A, meetingId);
  expect(m!.attendees).toHaveLength(2);
  expect(m!.attendees.every((a) => a.isMember && a.isFalconUser)).toBe(true);

  const wc = await readWorkingCopy(deps, WS_A, meetingId);
  expect(wc!.utterances).toHaveLength(2);                 // empty skipped
  expect(wc!.utterances.map((u) => u.idx)).toEqual([0, 1]);
  expect(wc!.utterances[1]!.text).toContain('postgres');
  expect(wc!.utterances[0]!.speaker).toBeTruthy();        // resolved to user name

  expect(enqueued).toHaveLength(1);
  expect(enqueued[0]!.job).toEqual({ workspaceId: WS_A, meetingId });
  expect(enqueued[0]!.jobId).toContain(meetingId);
});

it('is idempotent: a second call returns the same meeting and re-enqueues the SAME coalescing job id', async () => {
  const first = await assembleAndEnqueue(deps, redis, S1, async () => {});
  const enq: Array<{ jobId: string }> = [];
  const second = await assembleAndEnqueue(deps, redis, S1, async (_j, jobId) => { enq.push({ jobId }); });
  expect(second!.meetingId).toBe(first!.meetingId);
  expect(enq).toHaveLength(1);                                  // re-drive (safe: same jobId dedups)
  expect(enq[0]!.jobId).toContain(first!.meetingId);
  expect((await getMeetingBySession(deps, WS_A, S1))!.id).toBe(first!.meetingId); // still ONE meeting
});

it('returns null for an unknown session', async () => {
  expect(await assembleAndEnqueue(deps, redis, randomUUID(), async () => {})).toBeNull();
});
