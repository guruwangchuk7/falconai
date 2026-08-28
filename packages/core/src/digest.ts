import { desc, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import type { CoreDeps } from './deps.js';

const DIGEST_SYSTEM =
  'You write a concise "Personal Work Digest": a factual summary of what this person has been ' +
  'working on recently, based ONLY on the provided artifacts. Target 800-1200 tokens. If there ' +
  'is little or no activity, say so plainly — never invent work. Do not editorialize about ' +
  'performance or make judgments about the person.';

/** F2.3 — generate the nightly Personal Work Digest. Logs to Langfuse via the provider; never
 *  overwrites a user's edited digest (FR-010). Honest empty state on no activity. */
export async function generateDigest(deps: CoreDeps, workspaceId: string, userId: string): Promise<void> {
  await deps.db.withTenant(workspaceId, async (tx) => {
    const arts = await tx
      .select({ type: schema.artifact.type, externalRef: schema.artifact.externalRef, title: schema.artifact.title, repo: schema.artifact.repoOrProject })
      .from(schema.artifact)
      .where(eq(schema.artifact.userId, userId))
      .orderBy(desc(schema.artifact.sourceUpdatedAt))
      .limit(60);

    const context = arts.length
      ? arts.map((a) => `- [${a.type}] ${a.repo ?? ''} ${a.externalRef} ${a.title ?? ''}`.trim()).join('\n')
      : '(no recent activity in the last 30 days)';

    const { text } = await deps.llm.chat.complete({
      system: DIGEST_SYSTEM,
      messages: [{ role: 'user', content: `Artifacts:\n${context}\n\nWrite the digest.` }],
      maxTokens: 1500,
      meta: { workspaceId, userId },
    });

    const model = deps.llm.chat.model;
    await tx
      .insert(schema.workDigest)
      .values({ workspaceId, userId, generatedText: text, generatedAt: new Date(), model, modelVersion: model })
      .onConflictDoUpdate({
        target: [schema.workDigest.workspaceId, schema.workDigest.userId],
        set: { generatedText: text, generatedAt: new Date(), model, modelVersion: model },
      });
  });
}

/** The digest actually used downstream: the user's edit wins over the generated version (FR-010). */
export function effectiveDigestText(d: { generatedText: string | null; editedText: string | null }): string | null {
  return d.editedText ?? d.generatedText;
}
