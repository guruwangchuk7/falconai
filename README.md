# FalconAI

> An AI teammate for every meeting. Falcon pairs every participant with a personal AI agent
> that knows their role, work history, and open tasks — and surfaces what the room is
> missing while the decision is still open. **Falcon never speaks out loud. It writes.**

**Phase 1 — the Context Layer — is built** (branch `001-context-layer`): a pnpm/Turborepo
monorepo under `packages/` + `apps/`, typecheck-clean but not yet run end-to-end (needs Docker
+ external accounts). Everything past Phase 1 (audio, pairing, mediation) is still spec/PRD only.

**New here? Start with [`START-HERE.md`](./START-HERE.md)** for the ordered action list, and
[`specs/001-context-layer/HANDOFF.md`](./specs/001-context-layer/HANDOFF.md) for how to run the code.

## Repository map

| Path | What it is |
|---|---|
| [`START-HERE.md`](./START-HERE.md) | **Read first** — the ordered "what to do next" list (security, waitlist, running the build). |
| [`PRD.md`](./PRD.md) | **Product source of truth** — Falcon PRD (v2.7). |
| [`design.md`](./design.md) | **Design source of truth** — the landing-page HTML + "Quiet Voltage" design-system notes to preserve when re-platforming to Next.js. |
| [`design/landing.html`](./design/landing.html) | Standalone, openable copy of the landing page (waitlist wired to Supabase). |
| `packages/` | Workspace libraries: `db` (schema + RLS + partitions), `core` (ingest/retrieve/digest), `llm`, `integrations`, `secrets`, `config`, `queue`. |
| `apps/` | `web` (Next.js dashboard + API route handlers) and `worker` (BullMQ sync/index/digest/poll jobs). |
| `specs/001-context-layer/` | The full Spec Kit artifact set for Phase 1: `spec.md` → `plan.md` → `research.md` → `data-model.md` → `contracts/` → `tasks.md` → `quickstart.md` → `HANDOFF.md`. |
| `tests/integration/` | Isolation / ACL / partition-prune / pooling guard tests (Testcontainers; SC-003 blocker-class). |
| [`.env.example`](./.env.example) | Environment template — copy to `.env` and fill (grouped required vs optional). |
| [`TODOS.md`](./TODOS.md) | Backlog: blocker-class items, validation gaps, and residual code-review findings. |
| [`reviews/`](./reviews/) | The decision record — why every product/architecture call was made. |
| [`CLAUDE.md`](./CLAUDE.md) | How Claude Code operates in this repo — sources of truth, workflow, constraints. |
| `.specify/` | [GitHub Spec Kit](https://github.com/github/spec-kit) — SDD scaffolding, templates, and the project constitution (`.specify/memory/constitution.md`). |
| `.claude/skills/speckit-*` | Spec Kit slash-command skills (`/speckit-specify`, `/speckit-plan`, …). |
| `graphify-out/` | Graphify knowledge graph of the corpus (regenerate with `/graphify`). |

## How work flows here

1. **Spec-Driven Development** via Spec Kit: constitution → specify → (clarify) → plan →
   tasks → (analyze/checklist) → implement. Features live under `specs/<feature>/`.
2. **Knowledge graph** via Graphify: ask architecture questions as `/graphify query "…"`;
   refresh after doc changes with `/graphify . --update`.
3. **Roadmap** follows PRD §17: context layer → solo client → pairing → mediation.

## Next steps

- **Run Phase 1 locally:** follow [`START-HERE.md`](./START-HERE.md) §3 and
  [`specs/001-context-layer/HANDOFF.md`](./specs/001-context-layer/HANDOFF.md) (needs Docker + accounts).
- **Re-platform the marketing site** to Next.js, preserving `design.md` exactly.
- **Later phases** (solo client → pairing → mediation) start with `/speckit-specify`, per PRD §17.

Built in Bhutan.
