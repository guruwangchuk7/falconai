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

## 2. Fire the long-clock items today (they wait on other people, so start them early)
- [ ] **Email the privacy lawyer.** Attach `reviews/legal-brief-capture-consent.md`. Ask for a
  scoped two-hour read, and name questions **A3** (transient transcription = recording?) and
  **B6** (biometric/BIPA) as the two that gate a product decision. This gates the consent
  sections of the PRD and whether the system-audio fallback stays cut.
- [ ] **Start WoZ recruiting.** Piggyback the Phase 0 teams. The two card designs to test are in
  `design/woz-cards.html` (asymmetric vs symmetric). This is half the trigger to unlock the
  solo-first repositioning (D1).
- [ ] **Run the latency-window measurement (OV-3):** does a card land while the moment is still
  live? Cheap, and it can invalidate the live-mediation thesis before you build toward it.

## 3. Run the context layer that's now built (needs YOUR machine: Docker + accounts)
The code is written and typechecks; nothing has been executed. To prove it:
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
  click **Connect GitHub**, watch it sync and try `/decisions` + `/me/digest`.

## 4. Remaining build work (tell me to do these, or do them yourself)
- [ ] Linear/Jira **connect flow** + Linear webhook (adapters + sync jobs already exist).
- [ ] The **recall@k eval** harness — settle `voyage-code-4` vs `voyage-4-large` (+ rerank).
- [ ] Wire **Sentry + PostHog**; add **rate limiting** on connect/webhook; add **CI gates**
  (the partition-prune EXPLAIN assertion + "no token in app DB" check) and a Playwright smoke.
- [ ] Pick the concrete **secrets store** (research D3) before the connect flow ships to prod.
- [ ] Rebuild the **§18 economics** pool number from real Phase-1 telemetry (OV-7).

## 5. Decisions still open (yours to make)
- [ ] **D1 — solo-first repositioning:** apply after the WoZ result + a Phase-2 solo-retention
  read (trigger is written into the PRD v2.7 changelog). It edits `PRD.md` + `design.md` +
  `landing.html`, so do it once, with evidence.
- [ ] **OV-10 — erasure/tombstoning** design for the Decision Index (before it compounds).
- [ ] Whether to keep the **system-audio fallback** cut (waits on the lawyer read).

## 6. Ship it when you're happy
- The build lives on branch **`001-context-layer`** (16 commits). Review the diff, run it, then
  merge / open a PR (or run `/ship`). `main` still holds the reviewed PRD (v2.7) + the docs.

---

### One-line status
Planning + reviews: done. Context layer: **written and typecheck-clean, not yet run.** The
distance to "shipped" is: run it on your machine, pass the guard tests, close the section-4 gaps,
and make the section-5 calls.
