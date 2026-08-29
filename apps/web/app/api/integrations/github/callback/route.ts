import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { defaultJobOpts, syncQueue } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { deps } from '@/lib/deps';
import { GH_STATE_COOKIE } from '@/lib/github-oauth';

export const runtime = 'nodejs';

/** Constant-time string compare that tolerates unequal lengths (returns false, no throw). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** GitHub App install callback: record the connection (idempotent on installation id) and kick
 *  off the initial sync. */
export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));

  // CSRF: the `state` GitHub echoes back must match the nonce set at connect time. A missing or
  // mismatched state means the callback was not initiated by this user — reject before writing.
  const jar = await cookies();
  const expected = jar.get(GH_STATE_COOKIE)?.value;
  const got = new URL(req.url).searchParams.get('state');
  if (!expected || !got || !safeEqual(expected, got)) {
    const res = NextResponse.redirect(new URL('/integrations?error=invalid_state', req.url));
    res.cookies.delete(GH_STATE_COOKIE);
    return res;
  }

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

  const res = NextResponse.redirect(new URL('/integrations', req.url));
  res.cookies.delete(GH_STATE_COOKIE); // single-use nonce
  return res;
}
