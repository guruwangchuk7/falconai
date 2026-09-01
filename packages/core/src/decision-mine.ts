import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@falcon/db';
import type { DecisionSegment } from './decision-extract.js';
import type { CoreDeps } from './deps.js';

/** Hash of the exact segments handed to the extractor. Widens automatically if the adapter later
 *  includes more segment types (e.g. PR comments), so "content changed" re-mining just works. */
export function contentHash(segments: DecisionSegment[]): string {
  const SEP = String.fromCharCode(0); // NUL — never appears in human PR/issue text
  const payload = segments.map((s) => [s.speaker ?? '', s.text].join(SEP)).join(SEP);
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Normalized title for suggest-time dedup/dismissal matching: lowercase, collapse whitespace,
 *  strip trailing punctuation. Deliberately lossy so trivial reworders match. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?,;:\s]+$/g, '');
}

export type MineResult = 'suggested' | 'no_decision' | 'error' | 'deferred';
export interface MinedRow { extractorVersion: string; contentHash: string; result: MineResult }

/** Mine-once idempotency ledger lookup (Ship 2): has this artifact already been mined at this
 *  content hash? Tenant-scoped (RLS). */
export async function getMinedRow(deps: CoreDeps, workspaceId: string, artifactId: string): Promise<MinedRow | null> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({
      extractorVersion: schema.minedArtifact.extractorVersion,
      contentHash: schema.minedArtifact.contentHash,
      result: schema.minedArtifact.result,
    }).from(schema.minedArtifact).where(eq(schema.minedArtifact.artifactId, artifactId)).limit(1);
    return r ? { ...r, result: r.result as MineResult } : null;
  });
}

/** Record (or update) the mine-once ledger row for an artifact. Upserts on (workspaceId,
 *  artifactId) so re-mining the same artifact overwrites rather than duplicates. */
export async function recordMined(
  deps: CoreDeps,
  workspaceId: string,
  artifactId: string,
  row: { result: MineResult; extractorVersion: string; contentHash: string; decisionId?: string | null; maxCandidateScore?: number | null },
): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    await tx.insert(schema.minedArtifact).values({
      workspaceId, artifactId, result: row.result, extractorVersion: row.extractorVersion,
      contentHash: row.contentHash, decisionId: row.decisionId ?? null, maxCandidateScore: row.maxCandidateScore ?? null,
    }).onConflictDoUpdate({
      target: [schema.minedArtifact.workspaceId, schema.minedArtifact.artifactId],
      set: { result: row.result, extractorVersion: row.extractorVersion, contentHash: row.contentHash, decisionId: row.decisionId ?? null, maxCandidateScore: row.maxCandidateScore ?? null, minedAt: new Date() },
    });
  });
}

/** Suggest-time suppression: a candidate is dropped if a decision_record with the same sourceRef AND
 *  a normalized-title match already exists — dismissed (D4) OR live (dedup on re-mine). Reuses
 *  `normalizeTitle` (single source of truth) against titles fetched from the DB. */
export async function isSuppressed(deps: CoreDeps, workspaceId: string, sourceRef: string, normalizedTitle: string): Promise<boolean> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const rows = await tx.select({ title: schema.decisionRecord.title })
      .from(schema.decisionRecord).where(eq(schema.decisionRecord.sourceRef, sourceRef));
    return rows.some((r) => normalizeTitle(r.title) === normalizedTitle);
  });
}

/** Ship-2 daily suggestion budget: count of origin=suggested decision records created today
 *  (tenant-scoped, UTC day boundary via date_trunc). */
export async function countSuggestionsToday(deps: CoreDeps, workspaceId: string): Promise<number> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.origin, 'suggested'), sql`${schema.decisionRecord.createdAt} >= date_trunc('day', now())`));
    return r?.n ?? 0;
  });
}
