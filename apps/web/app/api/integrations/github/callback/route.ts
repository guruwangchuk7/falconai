import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { defaultJobOpts, syncQueue } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';

export const runtime = 'nodejs';

/** GitHub App install callback: record the connection (idempotent on installation id) and kick
 *  off the initial sync. */
export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));

  const installationId = new URL(req.url).searchParams.get('installation_id');
  if (installationId) {
    const connId = await deps().db.withTenant(session.workspaceId, async (tx) => {
      const existing = await tx
        .select({ id: schema.connection.id })
        .from(schema.connection)
        .where(and(
          eq(schema.connection.provider, 'github'),
          eq(schema.connection.externalAccountRef, installationId),
        ))
        .limit(1);
      if (existing[0]) return existing[0].id;
      const ins = await tx
        .insert(schema.connection)
        .values({ workspaceId: session.workspaceId, userId: session.userId, provider: 'github', status: 'active', externalAccountRef: installationId })
        .returning({ id: schema.connection.id });
      return ins[0]!.id;
    });
    await syncQueue().add('sync', { workspaceId: session.workspaceId, connectionId: connId }, defaultJobOpts);
  }

  return NextResponse.redirect(new URL('/integrations', req.url));
}
