import { and, desc, eq, sql } from 'drizzle-orm';
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

export interface SilentStreakAlert { workspaceId: string; streak: number; latestMinedAt: Date }

/**
 * Silent-zero detector. A parser break / model change / prompt regression / API-shape change is
 * INDISTINGUISHABLE from a genuine "no decisions made" — all four produce `no_decision` ledger rows, which
 * is exactly why the fenced-JSON bug returned nothing in prod while every test stayed green. This finds the
 * signal that separates them: a RUN of consecutive `no_decision`. Any `suggested` resets the run, so a
 * normal decision cadence never trips it; a systematic break makes every extraction silent and the run
 * climbs past the threshold. Per-workspace (iterates workspaces like the reaper, since `mined_meeting` is
 * RLS'd), newest first. Returns the workspaces whose last `threshold` extractions were ALL `no_decision`.
 */
export async function checkSilentExtractionStreak(deps: CoreDeps, threshold: number): Promise<SilentStreakAlert[]> {
  if (threshold <= 0) return [];
  const workspaces = await deps.db.rootDb.select({ id: schema.workspace.id }).from(schema.workspace);
  const alerts: SilentStreakAlert[] = [];
  for (const ws of workspaces) {
    const rows = await deps.db.withTenant(ws.id, (tx) =>
      tx.select({ result: schema.minedMeeting.result, minedAt: schema.minedMeeting.minedAt })
        .from(schema.minedMeeting)
        .orderBy(desc(schema.minedMeeting.minedAt))
        .limit(threshold),
    );
    if (rows.length >= threshold && rows.every((r) => r.result === 'no_decision')) {
      alerts.push({ workspaceId: ws.id, streak: rows.length, latestMinedAt: rows[0]!.minedAt });
    }
  }
  return alerts;
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
