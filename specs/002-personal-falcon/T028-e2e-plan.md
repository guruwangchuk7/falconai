# T028 — authed Playwright e2e: build plan

**Status:** planned, not built. This is the one Phase-2 task that can only be *validated* in a
Docker/CI environment or on Guru's machine — writing it blind (never executed once) would land a
red/flaky test and corrupt CI signal, so it's specced here instead of committed half-done.

**Goal (from tasks.md):** open the Falcon panel → ask → see a grounded, cited answer, as a
signed-in user, driving the real Next server end-to-end. Extends the T043 smoke shell
(`apps/web/e2e/smoke.spec.ts`, the skipped signed-in journey) and `apps/web/playwright.config.ts`.

Coverage note: the HTTP contract (auth gate, ownership 404, grounding, persistence, `query_event`)
is already covered at the handler level by `tests/contract/falcon-summary.test.ts` (T022) and
`tests/integration/answer.test.ts`. T028 adds only the **browser → real server → DB** layer.

---

## The three things a running-server authed e2e needs

1. **An authenticated session** without real GitHub OAuth (the original deferral reason).
2. **A seeded tenant** (workspace + user + ≥1 synced artifact + embedded chunk) so an ask can ground.
3. **A deterministic LLM** — CI has no Anthropic/Voyage keys, and the ask path calls
   `createLlmProviders()` inside the server process, which currently has **no test-provider seam**.

(1) is easy and clean. (2) and (3) are the real work — they're why this is environment-bound.

### 1. Session — mint a properly-signed Auth.js cookie (RECOMMENDED, zero prod change)

Auth.js v5 (`next-auth@5.0.0-beta.25`) stores the session as an encrypted JWT (JWE) in the
`authjs.session-token` cookie (http/localhost) or `__Secure-authjs.session-token` (https). The
`session` callback in `apps/web/lib/auth.ts` copies `token.userId` / `token.workspaceId` onto the
session on **every** request — so a minted token carrying those fields is enough; the `jwt` callback
(which runs only on real sign-in) is bypassed harmlessly.

Helper (`apps/web/e2e/support/session.ts`):
```ts
import { encode } from 'next-auth/jwt';
const COOKIE = 'authjs.session-token';           // '__Secure-authjs.session-token' if baseURL is https
export async function mintSessionCookie(userId: string, workspaceId: string) {
  const value = await encode({
    salt: COOKIE,                                  // v5: salt === cookie name
    secret: process.env.AUTH_SECRET!,
    token: { sub: userId, userId, workspaceId, email: 'e2e@x.com', name: 'e2e' },
  });
  return { name: COOKIE, value, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' };
}
```
In the test: `await context.addCookies([await mintSessionCookie(UA, A)])`.

Why this over an env-gated `getActiveSession` bypass: it exercises the **real** auth verification
path and adds **zero production attack surface** — the token is only valid because the test holds
`AUTH_SECRET`; prod is unchanged. Prefer it. (The env-gated bypass is a fallback only if cookie
minting proves incompatible with a future Auth.js version — it touches the auth path and needs the
hard non-prod gate + review.)

### 2. Seeded tenant — a Playwright global-setup against the same DB the server uses

- Boot a pgvector Postgres (Testcontainers, as `tests/support/pg.ts` does) in a Playwright
  `globalSetup`, apply `0001_init.sql` + `0002_personal_falcon.sql`, create the `falcon_app` role.
- Seed workspace `A`, user `UA`, one `artifact` (owned by UA) + one `artifact_chunk` with an
  embedding whose vector matches the fake embedder (so retrieval returns it) — mirror the seed in
  `tests/contract/falcon-summary.test.ts`.
- Export `APP_DATABASE_URL` (falcon_app) + `DATABASE_URL` (owner) so the `webServer` Next process
  connects to *this* container. `globalSetup` writes them into `process.env` before `webServer`
  starts (Playwright runs globalSetup first).

### 3. Deterministic LLM — the missing seam (the real blocker)

The server builds its LLM via `apps/web/lib/deps.ts` → `createLlmProviders()`, which reads real
keys. Two options:

- **(a) Live creds (simplest, Guru's machine):** run the e2e during the live quickstart with real
  `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`. No code change; but non-deterministic answer text, so
  assert on *structure* (status=grounded, ≥1 citation rendered, citation link resolves) not wording.
- **(b) Test-provider seam (CI-friendly, small prod-code addition):** teach `createLlmProviders()`
  to return a canned provider when `FALCON_FAKE_LLM=1` (gate to non-prod, like the `falcon_app`
  test role). Then CI can run T028 fully offline and deterministically. This is the same shape as
  the fake LLM already used in the integration tests — just reachable from the running server.
  Recommend (b) so T028 becomes a real CI gate rather than a manual step.

---

## Files to add / touch

- `apps/web/e2e/support/session.ts` — the cookie minter (above).
- `apps/web/e2e/falcon.spec.ts` — the authed test: add session cookie → goto `/falcon` → type a
  question → assert a grounded answer renders with ≥1 clickable citation whose href resolves.
- `apps/web/e2e/global-setup.ts` — Testcontainer boot + migrate + seed + env export; referenced from
  `playwright.config.ts` via `globalSetup`.
- `apps/web/playwright.config.ts` — add `globalSetup`; keep `reuseExistingServer` for local runs.
- (option b) `packages/llm/src/index.ts` or `apps/web/lib/deps.ts` — `FALCON_FAKE_LLM` non-prod seam.
- CI: a new `e2e` job (ubuntu has Docker) running `pnpm --filter @falcon/web e2e` with
  `FALCON_FAKE_LLM=1` + `AUTH_SECRET` set; `npx playwright install --with-deps chromium` first.

## Verification (must run where Docker + a browser exist — CI or Guru's machine)

1. `npx playwright install chromium`
2. With option (b): `FALCON_FAKE_LLM=1 AUTH_SECRET=… pnpm --filter @falcon/web e2e`
   With option (a): real keys + a synced user, run during the quickstart.
3. Confirm: unauth `/falcon` still bounces to signin (existing smoke), and the authed spec renders a
   cited answer + the citation link resolves. Green twice in a row before wiring the CI gate
   (flake check).

## Recommendation

Do this in one sitting on Guru's machine (or wire option (b) + the CI `e2e` job together). Until then
Phase 2 is functionally + quality complete at 30/32; the T028 gap is the browser layer only, and its
contract is already guarded below the UI.
