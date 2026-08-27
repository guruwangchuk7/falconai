# FalconAI Constitution

The non-negotiable engineering principles for FalconAI. Spec Kit reads this file; every
`spec.md`, `plan.md`, and review must comply. These principles are derived from `PRD.md`
(the product source of truth) and exist to protect the properties that make Falcon
trustworthy in a live meeting.

## Core Principles

### I. PRD Is Law, Traceability Is Mandatory
Every spec, plan, and task traces to a requirement in `PRD.md` by its ID (F-, G-, R-, AD-).
No feature exists that the PRD doesn't sanction; no PRD requirement is quietly dropped. If a
build reveals the PRD is wrong, the PRD is amended first — code never silently diverges from
it. The wording of `PRD.md` and `design.md` is fixed reference material.

### II. Grounded or Silent (NON-NEGOTIABLE)
Falcon speaks only when it holds verifiable information a human lacks. Every claim in a card,
answer, or nudge must resolve to a real, ACL-checked, retrieved artifact ID — gate on
retrieval, not on generation (PRD F7.2). Gate 3 is enforced in code: no artifact citation,
no publish (PRD F8, R3, R4). Unverifiable claims are dropped, never hedged.

### III. Security Boundaries Are Code, Not Prose
Tenant isolation is enforced at the database layer via Postgres RLS — a missing app-layer
predicate must not leak data (PRD §12.9, R25). Publish-time ACL intersection guards every
shared card (F9.1a, R15). OAuth tokens live in a dedicated secrets manager under per-tenant
envelope encryption, never the app DB (R26). Untrusted input (speech, artifacts) is
structurally separated and provenance-gated (F7.2, R20). Raw audio never leaves the device
except as a transcription stream and is never stored (§12.3). These are boundaries, not
best-effort.

### IV. Honest Degradation Over Confident Wrongness
When the system cannot be certain — ambiguous utterance ordering, unresolved addressee,
stale sync, STT failure, a disconnected client — it surfaces a visible, degraded-but-honest
state rather than guessing (PRD R12 philosophy, F5.3/F5.4, §15.1). Correctness degrades only
after coverage: the merge stage never drops utterances; buffers are bounded with
drop-and-mark; the triage router is the single admission controller (§12.6). Cost and load
share one lever, never two competing subsystems.

### V. Measure the Judgments, Pin the Models
Every subjective LLM judgment (salience, stance, info-gap, premise-challenge) is logged with
its inputs and measured against the Phase-0 golden set before any prompt or model change
ships (PRD §12.7, R21). Model versions are pinned explicitly — never `-latest`; an upgrade is
a code change gated on the eval (§12.8, R22). The LLM and STT sit behind thin provider
interfaces so a swap is config plus a canary, not a rewrite.

## Additional Constraints — Product Invariants

- **Text-only, permanently in v1.** Falcon never emits audio into a meeting (PRD §3.2).
- **Exact attribution by construction** — each client transcribes only its owner's mic
  (PRD §6.1). Never infer speaker identity from voice characteristics.
- **Blame-neutral shared cards** — performance-adjacent facts are nudge-only (F9.2a, R24).
- **Human-in-the-loop on memory** — Decision Records are unconfirmed → confirmed →
  superseded; only confirmed records are retrievable (F10.1, R23). Falcon proposes; humans
  dispose — it never executes actions (§3.2).
- **Consent is visible and once-per-pair**; always-visible capture indicator (§12.4).
- **The design is preserved, not reinvented** — re-platforming the marketing site to Next.js
  keeps the `design.md` "Quiet Voltage" system, copy, and interactions intact.

## Development Workflow — Spec-Driven & Phased

- **Spec before code.** Features flow constitution → specify → (clarify) → plan → tasks →
  (analyze/checklist) → implement, via the `speckit-*` skills. No implementation without an
  approved spec and plan.
- **Respect the roadmap order** (PRD §17): context layer → solo client → pairing →
  mediation. Do not build a later phase's feature before its phase.
- **Setup gate.** Application code, the Next.js transformation, and PRD feature
  implementation require the owner's explicit approval before starting.
- **Architecture Decisions Pending** (PRD §22, AD-1…AD-8) are resolved by a spike in their
  named phase before the dependent code is committed — not decided on paper.

## Governance

This constitution supersedes ad-hoc practice. Amendments are made through
`/speckit-constitution` with a rationale, and must remain consistent with `PRD.md`; where
they diverge, the PRD is amended in the same change. Every plan and review verifies
compliance with Principles I–V; added complexity must be justified against them. Runtime
development guidance lives in `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-08-27 | **Last Amended**: 2026-08-27
