import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { schema } from '@falcon/db';
import { createEventLog } from '@falcon/session-core';
import { meetingExtractQueue, meetingExtractJobId, defaultJobOpts, type MeetingExtractJob } from '@falcon/queue';
import { MEETING_WORKING_COPY_TTL_HOURS } from '@falcon/config';
import {
  resolveSessionWorkspace, getMeetingBySession, createMeeting, persistWorkingCopy,
  type MeetingDeps, type Utterance, type Attendee,
} from '@falcon/core';

/** Injectable so tests don't need a live BullMQ; production uses the real queue. */
export type EnqueueExtract = (job: MeetingExtractJob, jobId: string) => Promise<void>;

const defaultEnqueue: EnqueueExtract = async (job, jobId) => {
  await meetingExtractQueue().add('meeting-extract', job, { ...defaultJobOpts, jobId });
};

/**
 * At session end: resolve the workspace (RLS bootstrap), then — all tenant-scoped — snapshot attendees,
 * assemble the finalized transcript from the Redis event log into a durable Postgres working copy (D7),
 * and enqueue the (budget-deferrable) meeting-extract job. Idempotent — one meeting per session. Returns
 * null if the session is unknown. Reads only utterance_final TEXT events; never audio (R6).
 */
export async function assembleAndEnqueue(
  deps: MeetingDeps, redis: Redis, sessionId: string, enqueue: EnqueueExtract = defaultEnqueue,
): Promise<{ meetingId: string } | null> {
  const workspaceId = await resolveSessionWorkspace(deps, sessionId);
  if (!workspaceId) return null;

  // Idempotency: createMeeting is not unique on sessionId, so guard here.
  const existing = await getMeetingBySession(deps, workspaceId, sessionId);
  if (existing) return { meetingId: existing.id };

  // All tenant-scoped now that we have the workspace: session meta + attendee snapshot (D12).
  const { sessionKey, startedAt, attendees, nameByUser } = await deps.db.withTenant(workspaceId, async (tx) => {
    const [s] = await tx.select({ sessionKey: schema.session.sessionKey, startedAt: schema.session.startedAt })
      .from(schema.session).where(eq(schema.session.id, sessionId)).limit(1);
    const memberRows = await tx
      .select({ userId: schema.sessionMembership.userId, name: schema.users.name })
      .from(schema.sessionMembership)
      .leftJoin(schema.users, eq(schema.users.id, schema.sessionMembership.userId))
      .where(and(eq(schema.sessionMembership.workspaceId, workspaceId), eq(schema.sessionMembership.sessionId, sessionId)));
    const wsMembers = new Set(
      (await tx.select({ userId: schema.membership.userId }).from(schema.membership)
        .where(eq(schema.membership.workspaceId, workspaceId))).map((r) => r.userId),
    );
    const nameBy = new Map(memberRows.map((r) => [r.userId, r.name ?? null] as const));
    const att: Attendee[] = memberRows.map((r) => ({
      userId: r.userId, displayName: r.name ?? null, isMember: wsMembers.has(r.userId), isFalconUser: true,
    }));
    return { sessionKey: s?.sessionKey ?? null, startedAt: s?.startedAt ?? null, attendees: att, nameByUser: nameBy };
  });

  // Assemble utterances from the event log — utterance_final only, in stream order, TEXT only.
  const events = await createEventLog(redis, sessionId).readFrom(null);
  const utterances: Utterance[] = [];
  for (const ev of events) {
    if (ev.type !== 'utterance_final') continue;
    const p = ev.payload as { userId?: string; text?: string; arrivalTs?: number };
    if (!p.text) continue;
    utterances.push({
      idx: utterances.length,
      speaker: (p.userId ? nameByUser.get(p.userId) : null) ?? p.userId ?? null,
      userId: p.userId ?? null,
      text: p.text,
      tsMs: p.arrivalTs ?? 0,
    });
  }

  const { meetingId } = await createMeeting(deps, workspaceId, {
    sessionId, title: sessionKey, startedAt, endedAt: new Date(),
    attendees, designatedReviewerUserId: attendees[0]?.userId ?? null, // provisional; Phase E may refine
  });
  const expiresAt = new Date(Date.now() + MEETING_WORKING_COPY_TTL_HOURS * 3600_000);
  await persistWorkingCopy(deps, workspaceId, meetingId, utterances, expiresAt);
  await enqueue({ workspaceId, meetingId }, meetingExtractJobId(workspaceId, meetingId));
  return { meetingId };
}
