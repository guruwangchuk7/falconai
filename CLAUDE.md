# CLAUDE.md — FalconAI

Operating instructions for Claude Code in this repository. Read this before doing anything.

## What FalconAI is

Falcon pairs every participant in a meeting with a personal AI agent that knows that
person's role, work history, and open tasks. A lightweight desktop app captures each
person's own microphone; the apps pair into a shared session; a Main Coordinator listens
across all of them and publishes grounded mediation cards. **Falcon never speaks out loud —
it writes.** Full detail lives in [`PRD.md`](./PRD.md).

## Sources of truth (do not contradict these)

| File | Role | Rule |
|---|---|---|
| [`PRD.md`](./PRD.md) | **Product source of truth** (Draft 2, v2.5) | Every feature, constraint, gate, and risk traces here. If a request conflicts with the PRD, surface the conflict — don't silently diverge. |
| [`design.md`](./design.md) | **Design source of truth** — the existing hand-built HTML landing page + "Quiet Voltage" design-system notes | Understand and **preserve** this when re-platforming the marketing site to Next.js. Re-platform, don't redesign. |
| `.specify/memory/constitution.md` | Engineering principles | Non-negotiable project constraints; Spec Kit reads it. |

**Do not change the wording of the PRD or the design.** They are reference artifacts.
Both were authored deliberately; treat their copy as fixed unless the owner (Guru) says
otherwise.

## Current stage — SETUP ONLY

> **Hard gate.** This repository is at project-setup stage. **Do not write application code,
> do not begin the Next.js transformation, and do not implement any PRD features until the
> owner (Guru) explicitly approves.** Setup, documentation, specs, and configuration only.

When implementation is approved, follow the phased roadmap in **PRD §17** — context layer
before audio, solo before paired, pairing before mediation. Do not jump ahead of the
current phase.

## How we work here — Spec-Driven Development (Spec Kit)

This repo is initialized with [GitHub Spec Kit](https://github.com/github/spec-kit). Every
feature flows through explicit artifacts before code. Use the `speckit-*` skills in order:

1. `/speckit-constitution` — establish / amend project principles (`.specify/memory/constitution.md`).
2. `/speckit-specify` — turn a PRD-derived feature into a `spec.md` (the *what* and *why*, no stack).
3. `/speckit-clarify` *(optional)* — de-risk ambiguity before planning.
4. `/speckit-plan` — produce the implementation plan (the *how*, with the stack below).
5. `/speckit-tasks` — generate dependency-ordered `tasks.md`.
6. `/speckit-analyze` / `/speckit-checklist` *(optional)* — consistency and quality gates.
7. `/speckit-implement` — execute tasks **(only once setup gate is lifted for that feature)**.

Feature artifacts live under `specs/<feature>/`. Scripts are PowerShell (`.specify/scripts/powershell/`).

## Knowledge graph — Graphify

This project uses **graphify** to keep a navigable knowledge graph of the corpus (PRD,
design, specs). Output lives in `graphify-out/`.

- Ask architecture / "how does X relate to Y" questions as graphify queries:
  `/graphify query "how does the triage router gate mediation cards?"`
- After material doc/spec changes, refresh incrementally: `/graphify . --update`.
- If `graphify-out/graph.json` exists, treat codebase/architecture questions as graphify
  queries first (per the graphify skill's fast path).

## Intended tech stack (from PRD §13 — for planning, not yet built)

- **Web app:** Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui + Radix. The
  marketing site must preserve `design.md`'s look.
- **Desktop app:** Tauri 2 (Rust core, webview UI), cpal audio, Silero VAD (ONNX). Panel UI
  shares React components with the dashboard.
- **Realtime core:** Node.js 24 + Fastify on Fly.io; WebSocket (audio+events) + SSE (panel
  push). Session worker is the stateful unit; state event-sourced to Redis.
- **Data:** Postgres + pgvector (Neon/Supabase) with Drizzle; **Postgres RLS for tenant
  isolation** (PRD §12.9, blocker-class); Redis (Upstash); Cloudflare R2; BullMQ jobs.
- **AI:** Claude Haiku (triage + participant agents), Claude Sonnet (coordinator). Pin
  explicit model versions — never `-latest` (PRD §12.8). LLM behind a thin provider
  interface. STT: Deepgram Nova streaming with AssemblyAI failover, behind a circuit breaker.
- **Integrations:** GitHub App (repo-scoped), Linear/Jira, Google/Microsoft Calendar,
  Notion, Slack. Webhook-for-active + poll-for-historical (PRD §15.1).
- **Auth:** Clerk or Auth.js + device pairing tokens. **Observability:** Langfuse, Sentry,
  PostHog.

> When building AI features, default to the latest, most capable Claude models and consult
> the `claude-api` skill for current model IDs and pricing rather than relying on memory.

## Non-negotiable product constraints (enforce in code, not just prompts)

These come from the PRD and must survive any implementation:

- **Text-only.** Falcon never emits audio into a meeting (PRD §3.2).
- **Gate 3 in code.** No mediation card publishes without a verifiable artifact citation
  (PRD F8/R3). No citation → no publish.
- **Provenance-gated output.** Every claim resolves to a real, ACL-checked, retrieved
  artifact ID; unverifiable claims are dropped, not hedged (PRD F7.2/R4/R20).
- **Publish-time ACL intersection.** Shared cards re-enforce ACLs against the intersection
  of all recipients; three-tier handling cite/abstract/route-to-nudge (PRD F9.1a/R15).
- **Blame-neutral shared cards.** Performance-adjacent facts are nudge-only (PRD F9.2a/R24).
- **Tenant isolation at the DB layer** via Postgres RLS; OAuth tokens in a dedicated secrets
  manager, never the app DB (PRD §12.9/R25/R26).
- **Raw audio never stored** beyond the transcription stream (PRD §12.3/R6).
- **Decision Record lifecycle** unconfirmed → confirmed → superseded; only confirmed records
  are retrievable (PRD F10.1/R23).

## Conventions

- Platform is Windows; shell is PowerShell (Bash tool also available). Prefer PowerShell for
  terminal ops.
- Keep the PRD and `design.md` verbatim. New docs and specs go in their own files.
- Reference requirements by their PRD IDs (F-numbers, G-numbers, R-numbers, AD-numbers) so
  specs and code trace back cleanly.
