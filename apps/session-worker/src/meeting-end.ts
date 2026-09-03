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
 * assemble the finalized transcript from the Redis event log, get-or-create the meeting (unique on
 * session via 0009), and ALWAYS persist the working copy + enqueue the extract job — on both the new-
 * and existing-meeting paths. That "always" is deliberate (D7): if a prior invocation crashed or
 * failed over between create and persist/enqueue, a re-invocation completes the partial meeting instead
 * of short-circuiting on the existing() check. persistWorkingCopy is an upsert and the extract job uses
 * a coalescing jobId, so the re-drive is safe. Returns null if the session is unknown. Reads only
 * utterance_final TEXT events; never audio (R6).
 */
export async function assembleAndEnqueue(
  deps: MeetingDeps, redis: Redis, sessionId: string, enqueue: EnqueueExtract = defaultEnqueue,
): Promise<{ meetingId: string } | null> {
  const workspaceId = await resolveSessionWorkspace(deps, sessionId);
  if (!workspaceId) return null;

  // Assemble attendee snapshot + session meta (ALWAYS — needed to create, and available for a recovery
  // re-run). All tenant-scoped now that we have the workspace.
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

  // Get-or-create the meeting (unique on session via 0009). A create race resolves to the winner.
  const existing = await getMeetingBySession(deps, workspaceId, sessionId);
  let meetingId: string;
  if (existing) {
    meetingId = existing.id;
  } else {
    try {
      meetingId = (await createMeeting(deps, workspaceId, {
        sessionId, title: sessionKey, startedAt, endedAt: new Date(),
        attendees, designatedReviewerUserId: attendees[0]?.userId ?? null,
      })).meetingId;
    } catch {
      const winner = await getMeetingBySession(deps, workspaceId, sessionId); // lost the create race
      if (!winner) throw new Error(`meeting create failed for session ${sessionId} with no existing row`);
      meetingId = winner.id;
    }
  }

  // ALWAYS ensure the durable working copy + extract job. Both are idempotent (upsert / coalescing jobId),
  // so a re-invocation after a partial failure COMPLETES the meeting rather than short-circuiting (D7).
  const expiresAt = new Date(Date.now() + MEETING_WORKING_COPY_TTL_HOURS * 3600_000);
  await persistWorkingCopy(deps, workspaceId, meetingId, utterances, expiresAt);
  await enqueue({ workspaceId, meetingId }, meetingExtractJobId(workspaceId, meetingId));
  return { meetingId };
}
