import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { provisionUser } from './provision';

/** Auth.js (GitHub). On sign-in we provision the app user + workspace and stash userId +
 *  workspaceId on the token/session (read by route handlers to scope tenant queries). */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const gh = profile as { login?: string; email?: string; name?: string };
        const email = gh.email ?? `${gh.login ?? token.sub}@users.noreply.github.com`;
        const p = await provisionUser({ email, name: gh.name ?? null, githubLogin: gh.login ?? null });
        (token as Record<string, unknown>).userId = p.userId;
        (token as Record<string, unknown>).workspaceId = p.workspaceId;
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
