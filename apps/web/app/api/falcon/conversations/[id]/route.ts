import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { citationUrl } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** GET /api/falcon/conversations/{id} — one conversation's turns (question + answer + sources) for
 *  the history view (spec 002, US3). Private to the caller: 404 if the conversation isn't owned by
 *  this user. The answer's effective text is `editedText ?? generatedText` (edit is authoritative). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await deps().db.withTenant(s.workspaceId, async (tx) => {
    const conv = await tx
      .select({ id: schema.conversation.id, title: schema.conversation.title })
      .from(schema.conversation)
      .where(and(eq(schema.conversation.id, id), eq(schema.conversation.userId, s.userId)))
      .limit(1);
    if (!conv[0]) return null;

    const turns = await tx
      .select({
        questionText: schema.question.text,
        kind: schema.question.kind,
        askedAt: schema.question.askedAt,
        answerId: schema.answer.id,
        status: schema.answer.status,
        generatedText: schema.answer.generatedText,
        editedText: schema.answer.editedText,
        dataAsOf: schema.answer.dataAsOf,
      })
      .from(schema.question)
      .innerJoin(schema.answer, eq(schema.answer.questionId, schema.question.id))
      .where(eq(schema.question.conversationId, id))
      .orderBy(asc(schema.question.askedAt));

    // Sources per answer (answer_citation → artifact), deduped, built into openable links.
    const answerIds = turns.map((t) => t.answerId);
    const cites = answerIds.length
      ? await tx
          .select({
            answerId: schema.answerCitation.answerId,
            externalRef: schema.artifact.externalRef,
            title: schema.artifact.title,
            type: schema.artifact.type,
            source: schema.artifact.source,
            repoOrProject: schema.artifact.repoOrProject,
          })
          .from(schema.answerCitation)
          .innerJoin(schema.artifact, eq(schema.artifact.id, schema.answerCitation.artifactId))
          .where(inArray(schema.answerCitation.answerId, answerIds))
      : [];

    const byAnswer = new Map<string, Array<{ externalRef: string; title: string | null; type: string; url: string | null }>>();
    for (const c of cites) {
      const list = byAnswer.get(c.answerId) ?? [];
      if (!list.some((x) => x.externalRef === c.externalRef && x.type === c.type)) {
        list.push({ externalRef: c.externalRef, title: c.title, type: c.type, url: citationUrl(c) });
      }
      byAnswer.set(c.answerId, list);
    }

    return {
      id: conv[0].id,
      title: conv[0].title,
      turns: turns.map((t) => ({
        questionText: t.questionText,
        kind: t.kind,
        status: t.status,
        text: t.editedText ?? t.generatedText,
        edited: t.editedText != null,
        dataAsOf: t.dataAsOf ? t.dataAsOf.toISOString() : null,
        citations: byAnswer.get(t.answerId) ?? [],
      })),
    };
  });

  if (!body) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(body);
}
