import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@falcon/db';
import type { CoreDeps } from './deps.js';

export interface DecisionResult {
  id: string;
  title: string;
  decision: string | null;
  supersedesId: string | null;
  createdAt: string;
  freshnessFlag: boolean; // older than the workspace horizon
  score: number;
}

/** F2.4 / F10.1 — Org Decision Index search. ONLY confirmed records are retrievable (FR-012);
 *  superseded is excluded; results past the freshness horizon are flagged. */
export async function searchDecisions(
  deps: CoreDeps,
  workspaceId: string,
  query: string,
  k = 10,
  horizonDays = 180,
): Promise<DecisionResult[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    const [qvec] = await deps.llm.embeddings.embed([query], 'query');
    const vecStr = `[${qvec!.join(',')}]`;
    const dist = sql<number>`${schema.decisionRecord.embedding} <=> ${vecStr}::vector`;

    const rows = await tx
      .select({
        id: schema.decisionRecord.id,
        title: schema.decisionRecord.title,
        decision: schema.decisionRecord.decision,
        supersedesId: schema.decisionRecord.supersedesId,
        createdAt: schema.decisionRecord.createdAt,
        score: dist,
      })
      .from(schema.decisionRecord)
      .where(and(eq(schema.decisionRecord.status, 'confirmed'), sql`${schema.decisionRecord.embedding} is not null`))
      .orderBy(dist)
      .limit(k);

    const horizon = Date.now() - horizonDays * 86_400_000;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      decision: r.decision,
      supersedesId: r.supersedesId,
      createdAt: r.createdAt.toISOString(),
      freshnessFlag: r.createdAt.getTime() < horizon,
      score: Number(r.score),
    }));
  });
}
