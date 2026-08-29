/** Shared GitHub App connect-flow constants. Kept out of the route files because Next.js route
 *  modules may only export route handlers (GET/POST/…) + a fixed config allowlist — exporting an
 *  arbitrary const from a `route.ts` breaks the generated `.next/types` typecheck. */

/** Name of the CSRF state cookie shared between the connect start and the install callback
 *  (double-submit token). */
export const GH_STATE_COOKIE = 'gh_oauth_state';
