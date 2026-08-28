import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { githubEnv, loadEnv } from '@falcon/config';
import { getActiveSession } from '@/lib/session';

export const runtime = 'nodejs';

/** Name of the CSRF state cookie shared with the callback (double-submit token). */
export const GH_STATE_COOKIE = 'gh_oauth_state';

/** Start the GitHub App installation flow. GitHub redirects back to the callback with an
 *  installation_id. (The App private key mints per-installation tokens, so there is no user
 *  OAuth token to store for GitHub — only the installation id.)
 *
 *  CSRF: a high-entropy `state` nonce is set in an httpOnly cookie AND passed to GitHub, which
 *  echoes it to the callback. The callback rejects any mismatch — so an attacker cannot forge a
 *  callback that binds their installation into a victim's workspace (they can't read/set the
 *  victim's cookie). */
export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));
  const slug = loadEnv(githubEnv).GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: 'GITHUB_APP_SLUG not configured' }, { status: 500 });

  const state = randomBytes(32).toString('hex');
  const res = NextResponse.redirect(`https://github.com/apps/${slug}/installations/new?state=${state}`);
  res.cookies.set(GH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min — the install flow is short-lived
  });
  return res;
}
