# Feature Specification: Personal Falcon

**Feature Branch**: `002-personal-falcon`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Phase 2 — Personal Falcon (solo/personal-first wedge, per D1 decision in `reviews/d1-decision-memo.md`). A private, per-user AI agent that answers grounded questions about the user's own work (and their team's history) using the Phase 1 context layer. Personal-agent foundation the Main Coordinator (Phase 3-4) later sits on top of — a PRD §17 build-order reorder, not a change to the vision."

> **Context.** This is Phase 2 of Falcon (PRD §17). Phase 1 (`specs/001-context-layer`) already
> connects sources, syncs work into artifacts + embeddings + a decision index, and enforces
> tenant isolation and provenance-gated retrieval. Phase 2 turns that memory into a **personal
> agent a user can ask**. It deliberately excludes audio, pairing, and the Main Coordinator — those
> remain the roadmap for Phases 3-4. Grounded in the Wizard-of-Oz field test (`reviews/woz-results.md`):
> users independently asked for a private pull/Q&A mode, chose per-person agents + a Coordinator over
> one shared Falcon, and found live push-cards latency-bound (~60s) — the pull model has no such wall.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask Falcon about my own work (Priority: P1)

A person is about to explain their work in a standup, code review, or handoff and can't fully
recall the details. They privately ask Falcon a natural-language question about what they did —
"What did I complete for authentication, and does it follow the architecture we agreed on?" — and
get a short, grounded answer that cites the real artifacts it drew from (PRs, commits, issues,
confirmed decisions). Nothing is guessed; if there's no grounded source, Falcon says so.

**Why this priority**: This is the validated wedge from the WoZ — the most-requested, highest-value,
lowest-risk capability, and it is buildable directly on the Phase 1 context layer. It delivers value
to a single user with no other users present, so it is a viable MVP on its own.

**Independent Test**: With one user who has connected a source and synced their work, asking a
question about their own work returns a grounded, cited answer (or an honest "no grounded answer"),
verifiable by clicking through to the cited artifacts.

**Acceptance Scenarios**:

1. **Given** a user with synced work, **When** they ask "What did I do for authentication?", **Then** Falcon returns a concise answer whose every claim links to a real artifact the user has access to.
2. **Given** a question with no supporting artifact, **When** the user asks it, **Then** Falcon states it has no grounded answer rather than fabricating one.
3. **Given** an answer is shown, **When** the user opens a cited source, **Then** it resolves to the actual artifact the claim was drawn from.

---

### User Story 2 - Ask Falcon about the team's recent work (Priority: P2)

A person wants to bring older or missed context into the present — "What happened with Feature X?"
or "What did we finish in GitHub last week?" — and gets a grounded answer drawn only from artifacts
they are permitted to see. This is the "the team forgets, Falcon remembers" value that every WoZ
team confirmed.

**Why this priority**: Strong validated value (H1 held across teams), but slightly broader than
self-context and depends on the same retrieval spine, so it follows P1.

**Independent Test**: A user asks about a team artifact they have access to and receives a grounded,
cited answer; asking about an artifact they do NOT have access to returns nothing about it.

**Acceptance Scenarios**:

1. **Given** team work the user can access, **When** they ask "What happened with Feature X?", **Then** Falcon summarizes it with citations to the accessible artifacts.
2. **Given** an artifact the user is not permitted to see, **When** they ask about it, **Then** Falcon does not reveal its contents.
3. **Given** a decision that was proposed but never confirmed, **When** the user asks about it, **Then** only confirmed decisions are presented as decisions.

---

### User Story 3 - Prepare for a meeting with a targeted summary (Priority: P3)

Before a standup, review, or handoff, a person asks Falcon for a focused summary of a specific
slice of their work ("summarize my auth work for review") and gets a readable, grounded brief they
can speak from — a targeted version of the existing broad digest.

**Why this priority**: High-value prep use case, but a specialization of P1's Q&A; can ship after
the core question-answer loop works.

**Independent Test**: A user requests a summary scoped to a topic/time window and receives a
grounded brief citing the underlying artifacts.

**Acceptance Scenarios**:

1. **Given** synced work on a topic, **When** the user asks for a prep summary of it, **Then** Falcon returns a concise, source-cited brief.
2. **Given** the user disagrees with the summary, **When** they edit it, **Then** their edited version is what Falcon treats as authoritative (consistent with the Phase 1 digest-edit behavior).

---

### Edge Cases

- **No grounded source** → Falcon explicitly says it has no grounded answer; it never fabricates or hedges an unverifiable claim.
- **Question spans an unconnected source** → Falcon tells the user that source isn't connected/synced rather than implying the work doesn't exist.
- **Ambiguous question** → Falcon asks a brief clarifying question or returns the best grounded matches with their citations.
- **Access-restricted artifact** → never surfaced in an answer, even if relevant; the user cannot infer its contents.
- **Superseded/unconfirmed decision** → only confirmed decision records are presented as decisions; superseded ones are not resurfaced as current.
- **Stale sync** → answers reflect the last successful sync; the user can see how current the underlying data is.
- **Very large result set** → Falcon summarizes and cites the most relevant sources rather than dumping everything.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to ask natural-language questions about their own work and receive a grounded answer.
- **FR-002**: Users MUST be able to ask about their team's work, scoped to only the artifacts they are permitted to access.
- **FR-003**: Every factual claim in an answer MUST resolve to a real, retrieved, access-checked artifact; claims that cannot be grounded MUST be dropped, not hedged or guessed (provenance gate, PRD F7.2/R4/R20).
- **FR-004**: When no grounded source supports a question, the system MUST tell the user it has no grounded answer instead of producing one.
- **FR-005**: Every answer MUST show its sources such that the user can open and verify each cited artifact.
- **FR-006**: Retrieval MUST enforce tenant isolation and per-user access control — a user can never receive content from another tenant or from artifacts they cannot access (PRD §12.9/R25; proven live via the non-bypass DB role).
- **FR-007**: Only confirmed decision records MUST be retrievable as decisions; unconfirmed or superseded records MUST NOT be presented as current (PRD F10.1/R23).
- **FR-008**: Users MUST be able to request a targeted prep summary scoped to a topic and/or time window, grounded and cited.
- **FR-009**: Users MUST be able to correct/edit a summary, and the edited version MUST become what the system treats as authoritative (consistent with Phase 1 digest editing).
- **FR-010**: All output MUST be text; the system MUST NOT capture or store audio in this phase.
- **FR-011**: Users MUST be able to ask follow-up questions within the same line of inquiry, with earlier turns as context.
- **FR-012**: Answers MUST be presented in a readable panel/surface the user can open on demand, with answers phrased plainly (WoZ: "straightforward and easy to understand").
- **FR-013**: The system MUST record whether and when users return to ask questions, to measure solo retention (the Phase 2 success metric that confirms/updates D1).
- **FR-014**: The system MUST make clear how current the underlying data is (e.g., last-synced indication) so users can judge answer freshness.

### Key Entities *(include if feature involves data)*

- **Question**: a user's natural-language query, scoped to their identity and tenant; may belong to a multi-turn conversation.
- **Answer**: a grounded response composed of claims, each bound to one or more citations; may be "no grounded answer."
- **Citation**: a reference from a claim to a real, access-checked artifact (PR, commit, issue, confirmed decision) the user can open.
- **Conversation**: an ordered sequence of questions and answers providing follow-up context.
- **Prep Summary**: a targeted, grounded brief over a topic/time slice; editable, with the edited version authoritative.
- *(Reused from Phase 1)* **Artifact**, **Chunk/Embedding**, **Decision Record**, **User**, **Workspace/Tenant**, **Connection**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of factual claims in answers trace to a real artifact the asking user can access — zero fabricated or ungrounded claims in evaluation.
- **SC-002**: Zero cross-tenant or access-control leaks across the evaluation suite (a user never sees content they aren't permitted to).
- **SC-003**: Users receive an answer quickly enough to be useful on demand — median time-to-answer under ~10 seconds (pull model; no live-meeting latency constraint).
- **SC-004**: For questions where a grounded answer exists, ≥80% return a useful cited answer; for the rest, the system correctly says it has no grounded answer (matching the WoZ "didn't-know/would-change" value signal).
- **SC-005**: Solo retention — a majority of users who ask Falcon a question return to ask again within one week (the load-bearing metric that confirms personal-first before investing in the Coordinator).
- **SC-006**: Users rate answers helpful for standup/review/handoff prep (majority "yes, would use," consistent with the 5/5 WoZ "would use" signal).

## Assumptions

- **Builds on Phase 1**: reuses the shipped context layer (connected sources, synced artifacts, embeddings, decision index, tenant-isolated retrieval). No new source-integration work is required for the MVP beyond what Phase 1 provides.
- **Scope of "my work" and "team work"**: a user may ask about anything they are permitted to access; access control naturally bounds "team" to artifacts the user can see. No separate permission model is introduced.
- **Delivery surface**: the personal agent extends the existing product surface (the web dashboard where the digest and decisions already live) via a panel/sidebar — it does NOT require the desktop app; the desktop panel arrives with the meeting/pairing phases.
- **Interaction model**: conversational, multi-turn Q&A initiated by the user (pull), not proactively pushed — chosen because the WoZ showed push has a latency wall and pull does not.
- **Out of scope for Phase 2 (roadmap for Phases 3-4)**: microphone/audio capture, device pairing, the shared session worker, the Main Coordinator, and live in-meeting mediation cards. Excluded because the validated, lowest-risk wedge is personal pull/Q&A; the Coordinator layer is confirmed on the roadmap and gated on the Phase 2 solo-retention read.
- **Vision unchanged**: this is a build-order reorder of PRD §17, not a change to Falcon's goals; the full PRD end-state (personal agents + Main Coordinator + grounded mediation) still stands.
