import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { answerQuestion } from '@falcon/core';
import { rateLimit } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** POST /api/falcon/ask — grounded personal Q&A (spec 002-personal-falcon, US1/FR-001..005).
 *  Every claim is provenance-gated in the answer core (Constitution II); this route persists the
 *  conversation turn + citations + a retention query_event, all tenant-scoped via withTenant. */
export async function POST(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await rateLimit(`falcon-ask:${s.userId}`, 30, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const body = (await req.json()) as { question?: string; conversationId?: string };
  const questionText = body.question?.trim();
  if (!questionText) return NextResponse.json({ error: 'question required' }, { status: 400 });

  // Generate the grounded answer. Provider/embeddings failure → honest 503, never a guess (Const. IV).
  let answer;
  try {
    answer = await answerQuestion(deps(), {
      workspaceId: s.workspaceId,
      requesterUserId: s.userId,
      question: questionText,
    });
  } catch {
    return NextResponse.json(
      { error: 'Falcon is temporarily unavailable — try again in a moment.' },
      { status: 503 },
    );
  }

  // Persist the turn (conversation → question → answer → citations) + retention event, tenant-scoped.
  const { conversationId, answerId } = await deps().db.withTenant(s.workspaceId, async (tx) => {
    let convId = body.conversationId;
    if (convId) {
      const owned = await tx
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(eq(schema.conversation.id, convId))
        .limit(1);
      if (!owned[0]) convId = undefined; // not in tenant → start fresh (RLS already scopes reads)
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
      .values({ workspaceId: s.workspaceId, conversationId: convId, userId: s.userId, text: questionText, kind: 'qa' })
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

    // Retention metric (SC-005): one event per ask.
    await tx.insert(schema.queryEvent).values({ workspaceId: s.workspaceId, userId: s.userId, kind: 'qa' });

    return { conversationId: convId, answerId: a[0]!.id };
  });

  return NextResponse.json({
    answerId,
    conversationId,
    status: answer.status,
    claims: answer.claims,
    dataAsOf: answer.dataAsOf,
    ...(answer.degraded ? { degraded: answer.degraded } : {}),
    ...(answer.status === 'no_grounded_answer'
      ? { message: "I don't have anything in your synced work that answers this." }
      : {}),
  });
}
