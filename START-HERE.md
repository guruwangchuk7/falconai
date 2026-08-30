# START HERE — your action list (Guru)

Everything on your plate, in order. Times are yours (human), not CC-assisted.
Deeper detail: `TODOS.md` (backlog), `specs/001-context-layer/HANDOFF.md` (how to run the code),
`reviews/README.md` (why every decision was made).

---

## 0. Security — do this first (5 min)
- [ ] **Rotate the two secret keys you pasted into chat.** The Supabase **secret key**
  (`sb_secret_…`) and the **service_role** JWT both bypass Row Level Security. In Supabase:
  roll the secret key, and rotate the JWT secret (regenerates service_role). The **publishable**
  key wired into `design/landing.html` is safe to keep (it's public by design, protected by RLS).

## 1. Fix the live waitlist (15 min — it's dropping signups now)
- [ ] In Supabase → SQL editor, create the table + policy (SQL is in `design/landing.html`
  lines ~761–769):
  ```sql
  create table waitlist (id uuid default gen_random_uuid() primary key,
    email text unique not null, created_at timestamptz default now());
  alter table waitlist enable row level security;
  create policy "anon can join waitlist" on waitlist for insert to anon with check (true);
  ```
- [ ] Submit a test email on the page. Success = a row appears; failure now degrades to a
  `mailto:` link instead of a fake "you're on the list."
  my answer: i have checked and it wokred.- guru wangchuk


## 2. Fire the long-clock items today (they wait on other people, so start them early)
- [ ] **Email the privacy lawyer.** Draft is ready at `reviews/lawyer-email-draft.md` — paste,
  attach `reviews/legal-brief-capture-consent.md`, send. It's scoped to a ~2-hour read on questions
  **A3** (consent record for the non-consenting party) and **B6** (pairwise vs session-scoped
  consent for group disclosure) — the two that gate a product decision. Gates the PRD consent
  sections and whether the system-audio fallback stays cut.
- [ ] **Start WoZ recruiting.** Plan + hypotheses + metrics + a paste-ready recruiting script are in
  `reviews/woz-test-plan.md`; the two card shapes to test are in `design/woz-cards.html` (asymmetric
  vs symmetric). This is half the trigger to unlock the solo-first repositioning (D1).
- [ ] **Run the latency-window measurement (OV-3):** does a card land while the moment is still
  live? Cheap, and it can invalidate the live-mediation thesis before you build toward it.

## 3. Run the context layer that's now built (needs YOUR machine: Docker + accounts)
The guard suite (isolation/ACL/partition-prune/pooling) now passes in CI on real Postgres —
SC-003 is proven. What's left is the LIVE app flow (connect a real source → sync → retrieve),
which needs your machine + creds:
- [ ] Install prereqs: **Docker Desktop**, Node 24, `corepack enable`. Accounts: Supabase,
  a **GitHub App** (repo-scoped, with a webhook + secret), Voyage, Anthropic, Redis (Upstash).
- [ ] Create the **GitHub App** (the fiddly one): repo permissions (contents, pull requests,
  metadata read), a webhook pointing at `/api/webhooks/github`, note the App id + private key +
  webhook secret + slug.
- [ ] `pnpm install`, then `cp .env.example .env` and fill every value. Use the Supabase
  **transaction-mode** pooler URL (port 6543), and set a base64 32-byte `SECRETS_KEK`.
- [ ] Create the app DB role (non-superuser, no BYPASSRLS) — exact grants are in
  `tests/support/pg.ts`. Then `pnpm --filter @falcon/db migrate`. **`migrate` shells out to
  `psql`**, so psql must be on PATH and `DATABASE_URL` **exported into your shell** (psql doesn't
  read `.env`): `export DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-)`.
- [ ] **Run the guard tests (Docker):** `pnpm test:integration`. The isolation, ACL,
  partition-prune, and fail-closed tests must pass — SC-003 (tenant isolation) is blocker-class.
- [ ] `pnpm --filter @falcon/web dev` + `pnpm --filter @falcon/worker dev`, sign in with GitHub,
  click **Connect GitHub**, watch it sync and try `/decisions` + `/me/digest`. This is T044 — the
  last "never run live" surface.
- [ ] Optional smoke (no creds, just the app up): `npx playwright install chromium` then
  `pnpm --filter @falcon/web e2e` — checks boot + the auth boundary.

## 4. Remaining build work
Most Phase-1 build work is done and on `main`. What's DONE (added post-build): Linear + Jira connect
flows, `recall@k` eval harness (`pnpm --filter @falcon/evals recall`, needs `VOYAGE_API_KEY`),
Sentry/PostHog wiring, connect/webhook rate limiting, CI gates (partition-prune EXPLAIN + no-token-in-DB),
dev seed, and the Playwright smoke shell. Still open:
- [ ] Pick the concrete **secrets store** (research D3) before the connect flow ships to prod.
- [ ] Rebuild the **§18 economics** pool number from real Phase-1 telemetry (OV-7).
- [ ] The signed-in **T044** live run (above) + its Playwright authed journey.

## 5. Decisions still open (yours to make)
- [ ] **D1 — solo-first repositioning:** apply after the WoZ result + a Phase-2 solo-retention
  read (trigger is written into the PRD v2.7 changelog). It edits `PRD.md` + `design.md` +
  `landing.html`, so do it once, with evidence.
- [ ] **OV-10 — erasure/tombstoning** design for the Decision Index (before it compounds).
- [ ] Whether to keep the **system-audio fallback** cut (waits on the lawyer read).

## 6. Shipped — remaining ship-hygiene
- Phase 1 is **merged to `main`** (merge commit; the `001-context-layer` branch is kept). CI is
  green on `main`.
- [ ] **Enable branch protection** so CI is *required* to merge: GitHub → repo **Settings** →
  **Branches** → **Add rule** for `main` → check **Require status checks to pass** and select the
  `typecheck`, `integration`, and `no-token-in-db` checks → also **Require a pull request before
  merging** if you want review gates. (Right now nothing blocks a direct push to `main`.)

---

### One-line status
Planning + reviews: done. Context layer: **built; guard suite (incl. SC-003 isolation) green in
CI on real Postgres.** The distance to "shipped" is: rotate the leaked keys, run the LIVE app flow
on your machine (connect → sync → retrieve), then merge/ship. Most section-4 build gaps are now closed.

---

## Phase 2 — Personal Falcon (in progress: US1/US2/US3 MVP built)

The personal-agent wedge (per D1, `reviews/d1-decision-memo.md`) is built on the context layer and
running. **Try it:** sign in → **Ask Falcon** in the nav (`/falcon`). Ask about your own work
("what did I do for authentication?") or **Summarize a topic**; every claim shows its source, and
if Falcon can't ground an answer it says so. You can **edit** any answer — your version wins.

- Spec/plan/tasks: `specs/002-personal-falcon/` (30/32 tasks done). Grounding gate + RLS on the new
  tables are covered by automated tests (`tests/unit/answer-grounding.test.ts`,
  `tests/integration/personal-falcon-rls.test.ts`, `tests/integration/answer.test.ts`), and the
  summary + edit-authoritative + ownership routes now have a handler-level contract test
  (`tests/contract/falcon-summary.test.ts`, run in the CI integration job).
- **Success metric to watch:** solo retention (do you/testers come back to ask?) — this is the
  second half of the D1 trigger; a strong read confirms building toward the Coordinator.
- Still open (2): **T028** authed Playwright e2e — needs a test-env-only session-injection seam in
  `getActiveSession` (a production auth-path change; held for an explicit go); and **T030** the
  manual quickstart V1–V9 feel pass — needs your machine + live creds.
