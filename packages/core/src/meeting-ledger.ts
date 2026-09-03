import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@falcon/db';
import type { CoreDeps } from './deps.js';
import type { MineResult } from './decision-mine.js';

export interface MinedMeetingRow { extractorVersion: string; result: MineResult; transcriptRetainedUntil: Date | null }

/** Mine-once ledger lookup for a meeting. No contentHash (a finalized transcript is immutable, so
 *  meetingId + extractorVersion identifies the work). Tenant-scoped (RLS). */
export async function getMinedMeeting(deps: CoreDeps, workspaceId: string, meetingId: string): Promise<MinedMeetingRow | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({
      extractorVersion: schema.minedMeeting.extractorVersion,
      result: schema.minedMeeting.result,
      transcriptRetainedUntil: schema.minedMeeting.transcriptRetainedUntil,
    }).from(schema.minedMeeting).where(eq(schema.minedMeeting.meetingId, meetingId)).limit(1);
    return r ? { ...r, result: r.result as MineResult } : null;
  });
}

/** Record (or upsert) the mine-once ledger row for a meeting. `transcriptRetainedUntil` records whether a
 *  future re-mine is even possible (D6 ledger-honesty). */
export async function recordMinedMeeting(
  deps: CoreDeps, workspaceId: string, meetingId: string,
  row: { result: MineResult; extractorVersion: string; transcriptRetainedUntil?: Date | null; decisionId?: string | null; maxCandidateScore?: number | null },
): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    await tx.insert(schema.minedMeeting).values({
      workspaceId, meetingId, result: row.result, extractorVersion: row.extractorVersion,
      transcriptRetainedUntil: row.transcriptRetainedUntil ?? null,
      decisionId: row.decisionId ?? null, maxCandidateScore: row.maxCandidateScore ?? null,
    }).onConflictDoUpdate({
      target: [schema.minedMeeting.workspaceId, schema.minedMeeting.meetingId],
      set: {
        result: row.result, extractorVersion: row.extractorVersion,
        transcriptRetainedUntil: row.transcriptRetainedUntil ?? null,
        decisionId: row.decisionId ?? null, maxCandidateScore: row.maxCandidateScore ?? null, minedAt: new Date(),
      },
    });
  });
}

/** Reserved meeting budget lane (D11): count today's meeting-sourced suggestions, independent of the PR
 *  miner's budget — so a heavy sync day never defers meeting extraction. */
export async function countMeetingSuggestionsToday(deps: CoreDeps, workspaceId: string): Promise<number> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.origin, 'meeting'), sql`${schema.decisionRecord.createdAt} >= date_trunc('day', now())`));
    return r?.n ?? 0;
  });
}
