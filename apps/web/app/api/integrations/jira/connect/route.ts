import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { defaultJobOpts, rateLimit, syncQueue } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { deps, secrets } from '@/lib/deps';

export const runtime = 'nodejs';

/** Jira connect (Phase 1: API-token / Basic auth, poll-only — no OAuth redirect, no webhook).
 *  This is a same-origin authenticated form POST; the SameSite=Lax session cookie is the CSRF
 *  guard (a cross-site POST won't carry it). The user supplies their own base URL + email + API
 *  token, which we verify against Jira before storing the token in the SecretStore (R26: the
 *  connection row keeps only secret_ref). */
export async function POST(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url), 303);
  if (!(await rateLimit(`connect:${session.userId}`, 10, 60)).ok) {
    return NextResponse.redirect(new URL('/integrations?error=rate_limited', req.url), 303);
  }

  const form = await req.formData();
  const baseUrl = String(form.get('baseUrl') ?? '').trim().replace(/\/+$/, '');
  const email = String(form.get('email') ?? '').trim();
  const apiToken = String(form.get('apiToken') ?? '').trim();
  if (!baseUrl || !email || !apiToken || !/^https:\/\//.test(baseUrl)) {
    return NextResponse.redirect(new URL('/integrations?error=jira_fields', req.url), 303);
  }

  // Verify the credentials before persisting anything, so bad creds fail fast (not on first sync).
  const auth = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  const check = await fetch(`${baseUrl}/rest/api/3/myself`, { headers: { authorization: auth, accept: 'application/json' } });
  if (!check.ok) {
    return NextResponse.redirect(new URL('/integrations?error=jira_auth', req.url), 303);
  }

  const connId = await deps().db.withTenant(session.workspaceId, async (tx) => {
    const existing = await tx
      .select({ id: schema.connection.id, secretRef: schema.connection.secretRef })
      .from(schema.connection)
      .where(and(eq(schema.connection.provider, 'jira'), eq(schema.connection.externalAccountRef, baseUrl)))
      .limit(1);

    const token = { accessToken: apiToken, meta: { baseUrl, email } };
    if (existing[0]) {
      if (existing[0].secretRef) await secrets().rotate(existing[0].secretRef, token);
      await tx.update(schema.connection).set({ status: 'active', lastError: null }).where(eq(schema.connection.id, existing[0].id));
      return existing[0].id;
    }

    const ins = await tx
      .insert(schema.connection)
      .values({ workspaceId: session.workspaceId, userId: session.userId, provider: 'jira', status: 'active', externalAccountRef: baseUrl })
      .returning({ id: schema.connection.id });
    const id = ins[0]!.id;
    const secretRef = await secrets().put({ workspaceId: session.workspaceId, provider: 'jira', connectionId: id }, token);
    await tx.update(schema.connection).set({ secretRef }).where(eq(schema.connection.id, id));
    return id;
  });

  await syncQueue().add('sync', { workspaceId: session.workspaceId, connectionId: connId }, defaultJobOpts);
  return NextResponse.redirect(new URL('/integrations', req.url), 303);
}
