// Shared Linear OAuth helpers used by both the connect and callback routes. These live OUTSIDE the
// route files because Next.js App Router route modules may only export route handlers (GET/POST/…)
// and the recognized config fields — exporting anything else fails `next build` (App Router route
// type check). Keeping them here also gives the two routes a single source for the cookie name + URI.

/** CSRF state cookie shared with the Linear callback (double-submit token). */
export const LINEAR_STATE_COOKIE = 'linear_oauth_state';

/** Redirect URI Linear calls back — must match one registered on the OAuth application. */
export function linearRedirectUri(reqUrl: string): string {
  return new URL('/api/integrations/linear/callback', reqUrl).toString();
}
