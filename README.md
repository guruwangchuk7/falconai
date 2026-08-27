# FalconAI

> An AI teammate for every meeting. Falcon pairs every participant with a personal AI agent
> that knows their role, work history, and open tasks — and surfaces what the room is
> missing while the decision is still open. **Falcon never speaks out loud. It writes.**

This repository is at **project-setup stage**: documentation, specs, and configuration only.
No application code has been written yet, and none should be until the owner approves (see
the setup gate in [`CLAUDE.md`](./CLAUDE.md)).

## Repository map

| Path | What it is |
|---|---|
| [`PRD.md`](./PRD.md) | **Product source of truth** — Falcon PRD, Draft 2, v2.5. |
| [`design.md`](./design.md) | **Design source of truth** — the existing landing-page HTML + "Quiet Voltage" design-system notes to preserve when re-platforming to Next.js. |
| [`design/landing.html`](./design/landing.html) | Standalone, openable copy of the landing page (open in a browser to preview the design). |
| [`CLAUDE.md`](./CLAUDE.md) | How Claude Code operates in this repo — sources of truth, setup gate, workflow, constraints. |
| `.specify/` | [GitHub Spec Kit](https://github.com/github/spec-kit) — spec-driven-development scaffolding, templates, and the project constitution (`.specify/memory/constitution.md`). |
| `.claude/skills/speckit-*` | Spec Kit slash-command skills (`/speckit-specify`, `/speckit-plan`, …). |
| `graphify-out/` | Graphify knowledge graph of the corpus (regenerate with `/graphify`). |

## How work flows here

1. **Spec-Driven Development** via Spec Kit: constitution → specify → (clarify) → plan →
   tasks → (analyze/checklist) → implement. Features live under `specs/<feature>/`.
2. **Knowledge graph** via Graphify: ask architecture questions as `/graphify query "…"`;
   refresh after doc changes with `/graphify . --update`.
3. **Roadmap** follows PRD §17: context layer → solo client → pairing → mediation.

## Next steps (when the owner lifts the setup gate)

- `/speckit-specify` a first feature derived from the PRD (Phase 1: the context layer).
- Or scaffold the Next.js marketing site, preserving `design.md` exactly.

Built in Bhutan.
