import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** PATCH /api/falcon/answers/{id} — correct an answer/summary; the edited text becomes what
 *  Falcon treats as authoritative (spec 002, US3/FR-009), mirroring the digest edit behavior.
 *  Ownership: the answer's question must belong to the caller (within the tenant, RLS-scoped). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { editedText?: string };
  if (typeof body.editedText !== 'string') return NextResponse.json({ error: 'editedText required' }, { status: 400 });

  const editedAt = await deps().db.withTenant(s.workspaceId, async (tx) => {
    // Verify the answer exists and its question is owned by this user (private to the person).
    const owned = await tx
      .select({ answerId: schema.answer.id })
      .from(schema.answer)
      .innerJoin(schema.question, eq(schema.answer.questionId, schema.question.id))
      .where(and(eq(schema.answer.id, id), eq(schema.question.userId, s.userId)))
      .limit(1);
    if (!owned[0]) return null;
    const when = new Date();
    await tx.update(schema.answer).set({ editedText: body.editedText, editedAt: when }).where(eq(schema.answer.id, id));
    return when;
  });

  if (!editedAt) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ id, editedAt });
}
