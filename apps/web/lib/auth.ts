import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { provisionUser } from './provision';

/** Auth.js. On sign-in we provision the app user + workspace and stash userId + workspaceId on the
 *  token/session (read by route handlers to scope tenant queries).
 *
 *  Providers:
 *   - GitHub — the same GitHub *App* that powers repo sync (engineers). Always on.
 *   - Google — for pilot testers WITHOUT GitHub (non-engineers evaluating Decision Memory). Only
 *     enabled when AUTH_GOOGLE_ID/SECRET are set, so dev/GitHub-only deploys are unaffected. */
const providers = [
  // GitHub Apps return an RFC 9207 `iss` on the auth callback; tell Auth.js the expected issuer so
  // oauth4webapi validates it instead of rejecting it ("unexpected iss").
  GitHub({ issuer: 'https://github.com/login/oauth' }),
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google] : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosted (not Vercel), so Auth.js can't auto-detect the deployment host — trust it explicitly.
  // Without this, production refuses every auth request with UntrustedHost. Behind our single-domain
  // reverse proxy (Caddy on the Oracle VM; localhost in dev) this is the documented, expected setting.
  trustHost: true,
  providers,
  // Use our own Quiet Voltage sign-in page instead of the unstyled Auth.js default.
  pages: { signIn: '/signin' },
  callbacks: {
    async jwt({ token, profile, account }) {
      if (profile && account) {
        // GitHub gives us `login`; Google gives only email + name. Provision from whichever we got,
        // deduping by email (a person who later signs in with a different provider on the same email
        // maps to the same user). githubLogin is set only for a real GitHub sign-in.
        const p = profile as { login?: string; email?: string; name?: string };
        const isGitHub = account.provider === 'github';
        const email = p.email ?? (isGitHub && p.login ? `${p.login}@users.noreply.github.com` : `${token.sub}@users.noreply.local`);
        const prov = await provisionUser({ email, name: p.name ?? null, githubLogin: isGitHub ? (p.login ?? null) : null });
        (token as Record<string, unknown>).userId = prov.userId;
        (token as Record<string, unknown>).workspaceId = prov.workspaceId;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as Record<string, unknown>;
      (session as unknown as Record<string, unknown>).userId = t.userId;
      (session as unknown as Record<string, unknown>).workspaceId = t.workspaceId;
      return session;
    },
  },
});
