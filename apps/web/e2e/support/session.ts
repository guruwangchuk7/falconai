import { encode } from 'next-auth/jwt';

/**
 * Mint a properly-signed Auth.js v5 session cookie for the authed e2e (T028) — no GitHub OAuth.
 * This exercises the REAL auth verification path: the token is only valid because the test holds
 * AUTH_SECRET, so production is not weakened (no getActiveSession backdoor). The `jwt` callback is
 * bypassed (it runs only on real sign-in); the `session` callback copies userId/workspaceId from
 * the token, which is exactly what getActiveSession reads.
 */

// http/localhost dev cookie name. (An https origin would use `__Secure-authjs.session-token`.)
export const SESSION_COOKIE = 'authjs.session-token';

export async function mintSessionCookie(userId: string, workspaceId: string, baseURL: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required to mint a test session cookie');
  const value = await encode({
    salt: SESSION_COOKIE, // v5: the cookie name is the HKDF salt
    secret,
    token: { sub: userId, userId, workspaceId, email: 'e2e@x.com', name: 'e2e' },
  });
  return { name: SESSION_COOKIE, value, url: baseURL };
}
