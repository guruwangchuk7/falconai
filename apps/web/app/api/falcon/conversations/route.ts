import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** GET /api/falcon/conversations — the current user's conversations (private to the user within
 *  the tenant; RLS scopes to the workspace, the user_id filter scopes to the person). */
export async function GET() {
  const s = await getActiveSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await deps().db.withTenant(s.workspaceId, (tx) =>
    tx
      .select({ id: schema.conversation.id, title: schema.conversation.title, updatedAt: schema.conversation.updatedAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.userId, s.userId))
      .orderBy(desc(schema.conversation.updatedAt))
      .limit(50),
  );
  return NextResponse.json(rows);
}
