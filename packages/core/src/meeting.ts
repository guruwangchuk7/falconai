import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import type { CoreDeps } from './deps.js';

/** One finalized utterance in a meeting's working-copy transcript. NO raw audio — text only (R6). */
export interface Utterance { idx: number; speaker: string | null; userId: string | null; text: string; tsMs: number }

/** A snapshotted meeting attendee (D12). Frozen at meeting time; never re-derived from live membership. */
export interface Attendee { userId: string; displayName: string | null; isMember: boolean; isFalconUser: boolean }

export interface CreateMeetingInput {
  sessionId: string;
  title?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  attendees: Attendee[];
  designatedReviewerUserId?: string | null;
}

export interface MeetingRow {
  id: string;
  sessionId: string;
  title: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  attendees: Attendee[];
  designatedReviewerUserId: string | null;
  transcriptRetainedUntil: Date | null;
}

/** Create the durable meeting object with its immutable attendee snapshot (D12). Tenant-scoped (RLS). */
export async function createMeeting(deps: CoreDeps, workspaceId: string, input: CreateMeetingInput): Promise<{ meetingId: string }> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx.insert(schema.meeting).values({
      workspaceId,
      sessionId: input.sessionId,
      title: input.title ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? new Date(),
      attendees: input.attendees,
      designatedReviewerUserId: input.designatedReviewerUserId ?? null,
    }).returning({ id: schema.meeting.id });
    return { meetingId: row!.id };
  });
}

/** Persist (or replace) the durable working-copy transcript (D7). Idempotent upsert on (workspace, meeting). */
export async function persistWorkingCopy(deps: CoreDeps, workspaceId: string, meetingId: string, utterances: Utterance[], expiresAt: Date): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    await tx.insert(schema.meetingTranscript)
      .values({ workspaceId, meetingId, utterances, expiresAt })
      .onConflictDoUpdate({
        target: [schema.meetingTranscript.workspaceId, schema.meetingTranscript.meetingId],
        set: { utterances, expiresAt },
      });
  });
}

export async function readWorkingCopy(deps: CoreDeps, workspaceId: string, meetingId: string): Promise<{ utterances: Utterance[] } | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [row] = await tx.select({ utterances: schema.meetingTranscript.utterances })
      .from(schema.meetingTranscript)
      .where(and(eq(schema.meetingTranscript.workspaceId, workspaceId), eq(schema.meetingTranscript.meetingId, meetingId)))
      .limit(1);
    return row ? { utterances: row.utterances as Utterance[] } : null;
  });
}

export async function deleteWorkingCopy(deps: CoreDeps, workspaceId: string, meetingId: string): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    await tx.delete(schema.meetingTranscript)
      .where(and(eq(schema.meetingTranscript.workspaceId, workspaceId), eq(schema.meetingTranscript.meetingId, meetingId)));
  });
}

/** Record whether/until-when the full transcript is retained (D6 ledger-honesty). null = discarded. */
export async function setTranscriptRetainedUntil(deps: CoreDeps, workspaceId: string, meetingId: string, until: Date | null): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    await tx.update(schema.meeting)
      .set({ transcriptRetainedUntil: until })
      .where(and(eq(schema.meeting.workspaceId, workspaceId), eq(schema.meeting.id, meetingId)));
  });
}

export async function getMeeting(deps: CoreDeps, workspaceId: string, meetingId: string): Promise<MeetingRow | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select().from(schema.meeting)
      .where(and(eq(schema.meeting.workspaceId, workspaceId), eq(schema.meeting.id, meetingId)))
      .limit(1);
    if (!r) return null;
    return {
      id: r.id, sessionId: r.sessionId, title: r.title,
      startedAt: r.startedAt, endedAt: r.endedAt,
      attendees: (r.attendees as Attendee[]) ?? [],
      designatedReviewerUserId: r.designatedReviewerUserId,
      transcriptRetainedUntil: r.transcriptRetainedUntil,
    };
  });
}
