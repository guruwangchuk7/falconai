import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { effectiveDigestText } from '@falcon/core';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

export async function GET() {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await deps().db.withTenant(s.workspaceId, (tx) =>
    tx.select().from(schema.workDigest).where(eq(schema.workDigest.userId, s.userId)).limit(1),
  );
  const d = rows[0];
  return NextResponse.json({
    generatedText: d?.generatedText ?? null,
    editedText: d?.editedText ?? null,
    effectiveText: d ? effectiveDigestText(d) : null,
    generatedAt: d?.generatedAt ?? null,
    editedAt: d?.editedAt ?? null,
  });
}

export async function PUT(req: Request) {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as { text?: string };
  if (typeof body.text !== 'string') return NextResponse.json({ error: 'text required' }, { status: 400 });
  const text = body.text;
  await deps().db.withTenant(s.workspaceId, async (tx) => {
    await tx
      .insert(schema.workDigest)
      .values({ workspaceId: s.workspaceId, userId: s.userId, editedText: text, editedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.workDigest.workspaceId, schema.workDigest.userId],
        set: { editedText: text, editedAt: new Date() },
      });
  });
  return NextResponse.json({ ok: true });
}
