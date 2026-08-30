# Deployment Spec — Pilot: ship Personal Falcon to the first engineers

**Status:** proposed. **Owner:** Guru. **Depends on:** Phase 2 complete (32/32), D1 applied.
**Goal:** get the Personal Falcon (private grounded Q&A over each engineer's own GitHub work) running
on the public internet so the **5–9 engineers who already want it** can sign in, connect their repos,
and use it — producing the first real multi-user solo-retention data.

This is a *deployment* spec (it names the stack, unlike a product spec). It reuses the proven Phase-1
flow (connect→sync→retrieve, T044) and the proven tenant isolation (SC-003, RLS) — the new work is
hosting, multi-user onboarding, and the security gate.

---

## 1. Success criteria

- **SC-D1** Any invited engineer can, from a public URL: sign in with GitHub → connect their repos →
  see their work sync → ask a question → get a grounded, cited answer. (The T044 flow, but hosted +
  multi-user.)
- **SC-D2** Tenant isolation holds in production: no engineer can see another's artifacts or answers
  (RLS via `falcon_app`, already CI-proven; re-verified once live).
- **SC-D3** No secret is exposed: OAuth tokens live in the secrets store (not the app DB, R26);
  the previously-leaked keys are rotated; `main` is branch-protected.
- **SC-D4** Cost stays within the pilot budget (see §8) and Voyage rate limits don't break sync.

## 2. Target architecture (per PRD §13)

| Component | Host | Notes |
|---|---|---|
| Web app (Next.js dashboard + `/falcon`) | **Fly.io** app `falcon-web` | `next build` → `next start`; public HTTPS |
| Worker (BullMQ sync/index/digest) | **Fly.io** app `falcon-worker` | long-running `tsx src/index.ts`; no public port |
| Postgres + pgvector | **Supabase** (existing) | transaction pooler (6543); `falcon_app` runtime role (RLS), owner role for migrations |
| Redis | **Upstash** (existing) | TCP `rediss://` URL for ioredis/BullMQ (not the REST URL) |
| Object storage (later) | Cloudflare R2 | not required for Phase-2 pilot |
| Auth | Auth.js + GitHub App | prod callback/webhook URLs point at the Fly domain |
| Secrets (OAuth tokens) | dedicated secrets store | `SECRETS_BACKEND` — pick before prod (research D3); file-backend is dev-only |
| LLM | Anthropic (Haiku) | answers; pinned model version |
| Embeddings/rerank | **Voyage** (paid tier) | free tier is 3 RPM → multi-user sync needs paid |
| Observability | Sentry + PostHog | already wired (T029) |

## 3. Prerequisites (accounts/inputs Guru provides)

- Fly.io account + `flyctl` installed and authed (`fly auth login`).
- Supabase project (existing) — owner `DATABASE_URL` + `falcon_app` `APP_DATABASE_URL`.
- Upstash Redis TCP URL. A **GitHub App** (can reuse the dev one or create a `-prod` app).
- Anthropic API key. **Voyage API key with a payment method added** (lifts the 3 RPM cap).
- A domain (optional but recommended, e.g. `app.falcon.xyz`) or use the default `*.fly.dev`.

## 4. Security gate — DO FIRST (blocks go-live)

1. **Rotate the leaked keys** (START-HERE §0): Supabase secret key + JWT secret (service_role).
2. **Branch protection** on `main`: require the `typecheck`, `integration`, `no-token-in-db`, and
   `e2e` checks to pass before merge (START-HERE §6).
3. **Choose the prod secrets backend** (research D3). Until a managed store is picked, tokens must
   still never touch the app DB — the `no-token-in-db` CI gate enforces this; keep it green.
4. Generate a fresh 32-byte base64 `SECRETS_KEK` for prod (distinct from dev).

## 5. Deployment steps

### 5.1 Containerize (new files to create)
- `apps/web/Dockerfile` — multi-stage: `corepack enable` → `pnpm install --frozen-lockfile` (workspace
  root) → `pnpm --filter @falcon/web build` → runtime image runs `pnpm --filter @falcon/web start`.
  Needs the monorepo context (build from repo root with a root `.dockerignore`).
- `apps/worker/Dockerfile` — same base; runtime runs `pnpm --filter @falcon/worker start` (`tsx`).
- `fly.web.toml` / `fly.worker.toml` — app names, regions (pick nearest to users/Supabase), the web
  gets an HTTP service on 3000 + healthcheck on `/api/health` (add a trivial health route if missing);
  the worker has **no** public service. Set `min_machines_running=1` for the worker (always-on).

### 5.2 Secrets (per app, via `fly secrets set`)
Web: `APP_DATABASE_URL`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `AUTH_URL` (the prod origin),
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PKCS#8, single-line `\n`-escaped — gotcha #1),
`GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SECRETS_KEK`,
Sentry/PostHog keys. Worker: the same DB/Redis/GitHub/LLM/secrets set (no `AUTH_*`).
**Do NOT set `FALCON_FAKE_LLM`** in prod (it's non-prod-only anyway, but keep it absent).

### 5.3 Database
- Run migrations against Supabase as the **owner** (`DATABASE_URL`): `pnpm --filter @falcon/db migrate`
  (applies `0001`, `0002`). `migrate` shells to `psql` — run from a machine with psql + the URL
  exported (gotcha #7/#8), or a one-off `fly ssh`/CI job.
- Ensure the `falcon_app` role exists with the exact grants (non-superuser, no BYPASSRLS) and that
  the app connects as it via `APP_DATABASE_URL` — this is what makes RLS enforce (SC-D2).

### 5.4 GitHub App (prod callback wiring — the fiddly part, gotchas #2–#4)
- Repo permissions: Contents, Pull requests, Metadata = **Read**; a webhook → `https://<prod>/api/webhooks/github`.
- **Setup URL** → `https://<prod>/api/integrations/github/callback` (+ "Redirect on update").
- Auth callback URL includes `https://<prod>/api/auth/callback/github`; keep the `issuer` fix in `auth.ts`.

### 5.5 Deploy + landing page
- `fly deploy -c fly.web.toml` and `fly deploy -c fly.worker.toml`.
- **Landing page** (the new D1 personal-first copy in `design/landing.html`): deploy the static file
  to **Cloudflare Pages** or **Vercel static** (free), pointed at the waitlist Supabase table. This is
  separate from the app and is the public marketing front door.

### 5.6 Voyage
- Add a payment method to Voyage to lift the 3 RPM cap; keep the index-queue backoff (already built)
  as defense. Confirm embeddings succeed for a full repo sync without 429 storms.

## 6. Multi-user onboarding flow (what each engineer does)

1. Open the app URL → **Sign in with GitHub**.
2. **Connect GitHub** → install/authorize the Falcon App on their repos.
3. Watch their work sync (webhook-for-active + poll-for-historical); embeddings index in the worker.
4. Open **Ask Falcon** → ask about their own work → grounded, cited answers (clickable citations).
5. (Provide a 1-paragraph "how to use" + a few starter questions to seed the habit; retention is the metric.)

## 7. Verification (post-deploy)

- Re-run the **T044 live flow** on prod as two different engineers; confirm each sees only their own
  work (SC-D2 isolation) and gets grounded answers (SC-D1).
- Confirm one `query_event` per ask (SC-005 retention instrumentation) and that Sentry/PostHog receive
  events.
- Confirm the `no-token-in-db` invariant on the prod DB (no OAuth token columns).

## 8. Cost estimate (pilot, ~5–9 engineers)

| Item | Est. / month |
|---|---|
| Fly.io — web + worker (2 small always-on machines) | ~$5–10 |
| Supabase | $0 (free) → $25 (Pro) as data grows |
| Upstash Redis | $0 (free) → low usage-based |
| Anthropic (Haiku answers) | a few $ (fractions of a cent/question) |
| Voyage (paid tier, embeddings) | low $, usage-based; needed for multi-user sync |
| Landing (Cloudflare Pages/Vercel) | $0 |
| **Total infra** | **~$15–50/month** for the pilot |

The dominant *variable* cost is AI usage (Anthropic + Voyage), not hosting. See the funding doc
(`reviews/funding-request-dabtong-house.md`) for the full breakdown.

## 9. Risks / open items

- **Secrets backend (D3)** unresolved — pick a managed store before scaling beyond the pilot.
- **Voyage rate limits** — paid tier + queue pacing; watch the first multi-user sync.
- **Fly worker persistence** — ensure `min_machines_running=1` so BullMQ jobs aren't dropped.
- **§18 economics (OV-7)** — rebuild the unit-cost model from real pilot telemetry once flowing.
- **Erasure/tombstoning (OV-10)** — a real user deleting their data; design before it compounds.

## 10. Task checklist

- [ ] Security gate (§4): rotate keys, branch protection, `SECRETS_KEK`, secrets-backend choice.
- [ ] `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `.dockerignore`, `fly.web.toml`, `fly.worker.toml`.
- [ ] Add `/api/health` route (if missing) for Fly checks.
- [ ] `fly secrets set …` for web + worker.
- [ ] Migrate prod DB; confirm `falcon_app` role + grants.
- [ ] GitHub App prod callback/webhook/Setup URLs.
- [ ] Voyage payment method.
- [ ] `fly deploy` web + worker; deploy landing page.
- [ ] Verify §7 (two-user isolation + grounded answers + events).
- [ ] Invite the engineers; monitor retention (SC-005) + Sentry.
```
```
Next step after this spec: `/speckit-plan` then `/speckit-tasks`, or hand me the accounts and I wire it.
```
