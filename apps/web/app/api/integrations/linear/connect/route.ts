import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { linearEnv, loadEnv } from '@falcon/config';
import { rateLimit } from '@falcon/queue';
import { getActiveSession } from '@/lib/session';
import { LINEAR_STATE_COOKIE, linearRedirectUri } from '@/lib/linear-oauth';

export const runtime = 'nodejs';

/** Start Linear's OAuth2 flow. Unlike the GitHub App (installation-based), Linear returns an
 *  authorization `code` we exchange for an access token in the callback. A high-entropy `state`
 *  nonce (httpOnly cookie + query param) blocks CSRF on the callback. */
export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));
  if (!(await rateLimit(`connect:${session.userId}`, 10, 60)).ok) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const env = loadEnv(linearEnv);
  if (!env.LINEAR_CLIENT_ID) {
    return NextResponse.json({ error: 'LINEAR_CLIENT_ID not configured' }, { status: 500 });
  }

  const state = randomBytes(32).toString('hex');
  const authUrl = new URL('https://linear.app/oauth/authorize');
  authUrl.searchParams.set('client_id', env.LINEAR_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', linearRedirectUri(req.url));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'read');
  authUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(LINEAR_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min
  });
  return res;
}
