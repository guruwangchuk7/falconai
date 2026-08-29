import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { answerQuestion } from '@falcon/core';
import { captureEvent } from '@falcon/observability';
import type { ActiveSession } from './session';
import { deps } from './deps';

/** Run one grounded Falcon turn (qa or summary): generate the grounded answer, then persist the
 *  conversation/question/answer/citations + a retention query_event, all tenant-scoped. Shared by
 *  /api/falcon/ask and /api/falcon/summary so the grounding + persistence path is identical. */
export async function runFalconTurn(
  s: ActiveSession,
  questionText: string,
  kind: 'qa' | 'summary',
  conversationId: string | undefined,
) {
  const t0 = Date.now();
  const answer = await answerQuestion(deps(), {
    workspaceId: s.workspaceId,
    requesterUserId: s.userId,
    question: questionText,
  });
  const answerMs = Date.now() - t0; // time-to-answer (SC-003 visibility)

  const persisted = await deps().db.withTenant(s.workspaceId, async (tx) => {
    let convId = conversationId;
    if (convId) {
      const owned = await tx
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(eq(schema.conversation.id, convId))
        .limit(1);
      if (!owned[0]) convId = undefined; // RLS already scopes reads; unknown id → start fresh
    }
    if (!convId) {
      const ins = await tx
        .insert(schema.conversation)
        .values({ workspaceId: s.workspaceId, userId: s.userId, title: questionText.slice(0, 80) })
        .returning({ id: schema.conversation.id });
      convId = ins[0]!.id;
    } else {
      await tx.update(schema.conversation).set({ updatedAt: new Date() }).where(eq(schema.conversation.id, convId));
    }

    const q = await tx
      .insert(schema.question)
      .values({ workspaceId: s.workspaceId, conversationId: convId, userId: s.userId, text: questionText, kind })
      .returning({ id: schema.question.id });

    const a = await tx
      .insert(schema.answer)
      .values({
        workspaceId: s.workspaceId,
        questionId: q[0]!.id,
        status: answer.status,
        generatedText: answer.generatedText,
        model: answer.model,
        modelVersion: answer.modelVersion,
        generatedAt: new Date(),
        dataAsOf: answer.dataAsOf ? new Date(answer.dataAsOf) : null,
      })
      .returning({ id: schema.answer.id });

    const citations = answer.claims.flatMap((c) =>
      c.citations.map((cit) => ({
        workspaceId: s.workspaceId,
        answerId: a[0]!.id,
        artifactId: cit.artifactId,
        claimRef: c.text.slice(0, 200),
      })),
    );
    if (citations.length) await tx.insert(schema.answerCitation).values(citations);

    await tx.insert(schema.queryEvent).values({ workspaceId: s.workspaceId, userId: s.userId, kind });

    return { conversationId: convId, answerId: a[0]!.id };
  });

  // Usage/retention visibility (no-op unless PostHog is configured). Content is never sent —
  // only the shape (kind, grounded?, claim count).
  captureEvent(s.userId, `falcon_${kind}`, { status: answer.status, claims: answer.claims.length, answerMs });

  return {
    answerId: persisted.answerId,
    conversationId: persisted.conversationId,
    status: answer.status,
    claims: answer.claims,
    dataAsOf: answer.dataAsOf,
    ...(answer.degraded ? { degraded: answer.degraded } : {}),
    ...(answer.status === 'no_grounded_answer'
      ? { message: "I don't have anything in your synced work that answers this." }
      : {}),
  };
}
