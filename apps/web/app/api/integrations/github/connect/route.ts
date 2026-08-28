import { NextResponse } from 'next/server';
import { githubEnv, loadEnv } from '@falcon/config';
import { getActiveSession } from '@/lib/session';

export const runtime = 'nodejs';

/** Start the GitHub App installation flow. GitHub redirects back to the callback with an
 *  installation_id. (The App private key mints per-installation tokens, so there is no user
 *  OAuth token to store for GitHub — only the installation id.) */
export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) return NextResponse.redirect(new URL('/api/auth/signin', req.url));
  const slug = loadEnv(githubEnv).GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: 'GITHUB_APP_SLUG not configured' }, { status: 500 });
  return NextResponse.redirect(`https://github.com/apps/${slug}/installations/new`);
}
