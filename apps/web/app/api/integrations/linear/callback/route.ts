import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@falcon/db';
import { linearEnv, loadEnv } from '@falcon/config';
import { defaultJobOpts, syncQueue } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { deps, secrets } from '@/lib/deps';
import { LINEAR_STATE_COOKIE, linearRedirectUri } from '../connect/route';

export const runtime = 'nodejs';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Exchange the OAuth `code` for a Linear access token. */
async function exchangeCode(code: string, redirectUri: string, clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`linear token exchange failed: ${r.status}`);
  const json = (await r.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('linear token exchange returned no access_token');
  return json.access_token;
}

/** Resolve the Linear organization id — used as the connection's external ref so re-connects are
 *  idempotent and the webhook (which carries organizationId) can find the owning connection. */
async function fetchOrgId(token: string): Promise<string> {
  const r = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: '{ organization { id } }' }),
  });
  if (!r.ok) throw new Error(`linear org lookup failed: ${r.status}`);
  const json = (await r.json()) as { data?: { organization?: { id?: string } } };
  const id = json.data?.organization?.id;
  if (!id) throw new Error('linear org lookup returned no id');
  return id;
}

export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));

  // CSRF: the echoed `state` must match the nonce set at connect time.
  const jar = await cookies();
  const expected = jar.get(LINEAR_STATE_COOKIE)?.value;
  const url = new URL(req.url);
  const got = url.searchParams.get('state');
  if (!expected || !got || !safeEqual(expected, got)) {
    const res = NextResponse.redirect(new URL('/integrations?error=invalid_state', req.url));
    res.cookies.delete(LINEAR_STATE_COOKIE);
    return res;
  }

  const code = url.searchParams.get('code');
  const env = loadEnv(linearEnv);
  if (!code || !env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
    const res = NextResponse.redirect(new URL('/integrations?error=linear_misconfigured', req.url));
    res.cookies.delete(LINEAR_STATE_COOKIE);
    return res;
  }

  const token = await exchangeCode(code, linearRedirectUri(req.url), env.LINEAR_CLIENT_ID, env.LINEAR_CLIENT_SECRET);
  const orgId = await fetchOrgId(token);

  const connId = await deps().db.withTenant(session.workspaceId, async (tx) => {
    const existing = await tx
      .select({ id: schema.connection.id, secretRef: schema.connection.secretRef })
      .from(schema.connection)
      .where(and(eq(schema.connection.provider, 'linear'), eq(schema.connection.externalAccountRef, orgId)))
      .limit(1);

    if (existing[0]) {
      // Re-connect: rotate the stored token, reactivate.
      if (existing[0].secretRef) await secrets().rotate(existing[0].secretRef, { accessToken: token, scope: 'read' });
      await tx.update(schema.connection).set({ status: 'active', lastError: null }).where(eq(schema.connection.id, existing[0].id));
      return existing[0].id;
    }

    // New: insert first to get the id, store the token, then back-fill secret_ref (never the token).
    const ins = await tx
      .insert(schema.connection)
      .values({ workspaceId: session.workspaceId, userId: session.userId, provider: 'linear', status: 'active', externalAccountRef: orgId })
      .returning({ id: schema.connection.id });
    const id = ins[0]!.id;
    const secretRef = await secrets().put(
      { workspaceId: session.workspaceId, provider: 'linear', connectionId: id },
      { accessToken: token, scope: 'read' },
    );
    await tx.update(schema.connection).set({ secretRef }).where(eq(schema.connection.id, id));
    return id;
  });

  await syncQueue().add('sync', { workspaceId: session.workspaceId, connectionId: connId }, defaultJobOpts);

  const res = NextResponse.redirect(new URL('/integrations', req.url));
  res.cookies.delete(LINEAR_STATE_COOKIE); // single-use nonce
  return res;
}
