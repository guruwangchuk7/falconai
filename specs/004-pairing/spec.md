# Feature Specification: Pairing — Shared, Correctly-Attributed Sessions

**Feature Branch**: `004-pairing`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Phase 3 — Pairing. Two people, each running their own Personal Falcon, pair their apps into a shared session so a Main Coordinator can listen across both mics. Text-only; Falcon never speaks. Preserve all non-negotiable constraints. Build on the Phase 1 context layer and Phase 2 grounded-answer core."

> **Scope correction (PRD §17, Constitution I).** The triggering request asked this phase to
> *publish grounded mediation cards*. Per **PRD §17**, mediation-card synthesis, the intervention
> gates (F8), publish-time ACL intersection (F9.1a), blame-neutral synthesis (F9.2a), and Decision
> Records (F10) are **Phase 4 — Mediation**. **Phase 3 stops at the substrate**: session model,
> pairing, clock sync, transcript merge, multi-agent sessions, and shared open-thread *tracking* —
> "*still no mediation cards — just a shared, correctly-attributed transcript feeding multiple
> agents.*" This spec is scoped to that boundary. The card-publishing constraints named in the
> request are honored here only as far as they are **established at pairing time** (e.g. the
> `session_visibility_scope` ACL-intersection cache, F9.1a) so Phase 4 can enforce them cheaply.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Pair into a shared, correctly-attributed session (Priority: P1) 🎯 MVP

Two people who each run their own Falcon join the *same* meeting session with near-zero friction,
and everything either of them says lands in **one** shared transcript with **exact** attribution to
the person who said it — because each person's own app captures only that person's microphone.

**Why this priority**: This is the phase's spine and the whole reason pairing exists. A shared
session with correct attribution is the artifact every later capability (agents, thread tracking,
Phase-4 mediation) reads from. Without it, nothing downstream is trustworthy. It is also
independently valuable on its own: a live, correctly-attributed shared transcript of a meeting.

**Independent Test**: Start two Falcon clients, pair them (via a calendar match, a team auto-pair
prompt, or a 6-character code), have both people speak over each other and in turn, and confirm the
resulting single merged transcript attributes every utterance to the correct speaker with no
cross-talk misattribution, and that a persistent capture indicator was visible to both throughout.

**Acceptance Scenarios**:

1. **Given** two people invited to the same calendar event, each running Falcon, **When** both apps
   start, **Then** they land in the same session automatically with no user action (F7.1) and each
   sees an unmissable "Paired with <name>" indicator with a one-tap Leave (§7.2).
2. **Given** no shared calendar event but both users in the same workspace speaking within a
   90-second window, **When** Falcon detects the overlap, **Then** each is offered a one-tap "Join
   session with <name>?" prompt (F7.2).
3. **Given** an ad-hoc or cross-workspace call, **When** one person shares the 6-character session
   code, **Then** the other joins the same session; the code respects a TTL, a join rate limit, a
   scope, and shows join visibility (F7.3).
4. **Given** two paired participants, **When** both speak (including over each other), **Then** each
   client transcribes only its own owner's mic and the merged transcript attributes each utterance
   to its speaker by construction — speaker identity is never inferred from voice (G2, §6.1).
5. **Given** it is the first time these two people have ever paired, **When** the session forms,
   **Then** both see a one-time consent card stating what is shared (transcript, agent stances),
   what is not (private nudges, raw audio), and how to revoke; subsequent pairs auto-pair without
   re-consent, while cross-workspace pairs prompt every time (§7.2).

---

### User Story 2 — Each participant's agent reads the shared feed (Priority: P2)

For every paired human, the session provisions one Participant Agent bound to that human, grounded
in that person's own and ACL-visible team work (reusing the Phase 1 context layer + Phase 2 answer
core), and each agent consumes the live merged transcript. At pairing — and on any join or leave —
the session computes the `session_visibility_scope`: the intersection of artifacts every current
participant can access.

**Why this priority**: Multi-agent sessions are what make a paired session more than a transcript,
and computing the ACL-intersection scope at pairing is the load-bearing security precondition Phase 4
depends on (F9.1a). It is second because it requires US1's session + merged feed to exist first.

**Independent Test**: Pair two participants, confirm exactly two Participant Agents are provisioned
(one per human), each retrieving only within its owner's ACL, and confirm a `session_visibility_scope`
is computed at pairing and recomputed when a third person joins or someone leaves.

**Acceptance Scenarios**:

1. **Given** N paired participants, **When** the session bootstraps, **Then** exactly one Participant
   Agent is spawned per paired human, each compiled with that person's Context Pack (agenda, Role
   Profile, Work Digest, open PRs/tickets, relevant confirmed decisions) (F3).
2. **Given** a paired session, **When** a participant's agent retrieves context, **Then** it draws
   only from artifacts visible under that owner's ACL — no agent can reach another tenant's or
   another user's out-of-scope artifacts (§12.9, R25).
3. **Given** a session forms, **When** pairing completes, **Then** a `session_visibility_scope` (the
   ACL intersection across all current participants) is computed and cached; **When** anyone joins or
   leaves, **Then** it is recomputed (F9.1a).
4. **Given** a meeting already in progress, **When** a late participant joins, **Then** an agent is
   provisioned mid-session and backfilled with a compressed transcript (F3).

---

### User Story 3 — Shared open-thread tracking (Priority: P3)

The session maintains a live view of the distinct discussion threads in the conversation: each
utterance is matched to an existing Open Thread or opens a new one, using a continuation signal plus
topic similarity, with the thread state derived as a fold over the utterance log (never mutated in
place). **No gates, no cards, no interventions** — this phase only *tracks*.

**Why this priority**: Open-thread tracking is the data structure Phase 4's gates will read, so it
must exist and be correct before mediation is built — but on its own it publishes nothing, so it is
the lowest priority of the three and the safest to defer within the phase.

**Independent Test**: Run a multi-turn discussion that drifts across two topics and back; confirm the
Open Threads table correctly opens, continues, and (where applicable) merges/splits threads, and that
recomputing it from the event log after a simulated worker restart yields the identical table.

**Acceptance Scenarios**:

1. **Given** a live merged transcript, **When** an utterance arrives, **Then** the session matches it
   to an Open Thread (by continuation likelihood + topic embedding, against an explicit threshold) or
   opens a new thread; thread identity is owned by the session/Coordinator layer, not the triage
   router (F6.1a).
2. **Given** an Open Threads table built during a session, **When** all cached snapshots are deleted
   and state is recomputed from the event log, **Then** the resulting table is identical — thread
   state is derived, never a mutated counter (CX-1).
3. **Given** two utterances whose adjusted timestamps have overlapping error margins, **When** the
   merge orders them, **Then** their relative order is marked ambiguous rather than guessed, and no
   downstream consumer infers "who responded to whom" from timing alone (F5.3, R5).

---

### Edge Cases

- **Some paired, some not.** Unpaired participants' speech is **not captured** (the system-audio
  fallback was cut in v2.6 for two-party-consent/BIPA exposure, F4.7). The session functions on
  paired voices only and **explicitly flags the coverage gap** rather than reasoning on partial data
  (§7.3, Constitution IV).
- **Solo (nobody else paired).** The session degrades to single-participant mode — still a valid,
  useful state (this is the Phase-2 personal capability continuing), with no pairing-dependent
  behavior (§7.3).
- **Clock/order ambiguity.** When per-utterance timestamp error margins overlap, relative order is
  marked ambiguous; semantic cues (a reply naming the other's point) are the clock-independent
  fallback for ordering (F5.3).
- **Session-worker crash / failover.** Session state is event-sourced; a replacement worker
  reconstructs membership, merged transcript, and Open Threads from the log (no central supervisor —
  a symmetric reconciler), and lease + fencing token make double-ownership impossible (§6.3, §12.5,
  R14).
- **Cross-workspace pairing.** Always prompts for consent (never remembered); internal pairs are
  remembered (§7.2).
- **Session code abuse.** Codes expire (TTL), are rate-limited on join, are scoped, and show join
  visibility so a leaked code is bounded (F7.3).
- **Participant leaves mid-session.** Membership updates, the participant's agent is torn down, and
  `session_visibility_scope` is recomputed (F9.1a).
- **Late joiner.** Agent provisioned mid-session, backfilled with a compressed transcript (F3).

## Requirements *(mandatory)*

### Functional Requirements

**Pairing & session lifecycle**

- **FR-001**: The system MUST let two or more clients join one shared session via three mechanisms:
  calendar match as default (F7.1), same-workspace team auto-pair within a 90-second speaking window
  (F7.2), and a 6-character session code as fallback (F7.3).
- **FR-002**: Session codes MUST carry a TTL, a join rate limit, a defined scope, and visible join
  notification (F7.3).
- **FR-003**: The system MUST auto-pair repeat internal meetings with no user action, while
  cross-workspace pairing MUST prompt for consent every time (§7.2, G1).
- **FR-004**: On session bootstrap the system MUST resolve or create the session, establish the
  session clock, and compile a Context Pack per paired participant (F3).
- **FR-005**: The system MUST support participants joining and leaving mid-session, including
  provisioning a late joiner's agent backfilled with a compressed transcript, and tearing down an
  agent on leave (F3).

**Consent & capture indicator**

- **FR-006**: The first time two people ever pair, the system MUST show a one-time consent card
  naming what is shared (transcript, agent stances), what is not (private nudges, raw audio), and how
  to revoke; consent is at **session scope**, once per pair, not per meeting (§7.2, §12.4).
- **FR-007**: While capturing, the system MUST display a persistent, always-visible capture indicator
  and a persistent "Paired with <name> · N others" indicator with one-tap Leave (§7.2, §12.4).

**Audio capture & attribution** *(the capture foundation deferred from Phase 2 per §17 / v2.8)*

- **FR-008**: Each client MUST capture and transcribe **only its own owner's microphone**; speaker
  attribution MUST be exact by construction and MUST NOT be inferred from voice characteristics
  (§6.1, G2).
- **FR-009**: The system MUST detect speech, produce a streaming transcript per client, and stamp
  each utterance with a local monotonic timestamp plus the session clock offset (F4).
- **FR-010**: Raw audio MUST NOT be stored beyond the live transcription stream (§12.3, R6).

**Clock sync & transcript merge**

- **FR-011**: The system MUST merge per-client transcripts into one time-ordered shared feed. The
  merge MUST NOT drop utterances — coverage is preserved before correctness degrades (§12.6,
  Constitution IV).
- **FR-012**: The system MUST hold a per-client reorder buffer sized from measured jitter, attach an
  estimated error margin to each adjusted timestamp, and when two utterances' margins overlap MUST
  mark their relative order ambiguous rather than choosing one (F5.3, R5).
- **FR-013**: The system MUST propagate an `order_confidence` signal so downstream consumers do not
  act on contested ordering (§12.5).
- **FR-014**: The utterance-ordering approach MUST be resolved by the **AD-1 spike** before dependent
  code is committed — server-arrival ordering may replace the full clock-sync subsystem (PRD §22
  AD-1, Constitution "Architecture Decisions Pending").

**Multi-agent sessions & visibility scope**

- **FR-015**: The system MUST provision exactly one Participant Agent per paired human, each grounded
  in that owner's and ACL-visible team work via the Phase 1 context layer and Phase 2 answer core.
- **FR-016**: Each agent's retrieval MUST remain within its owner's ACL and tenant boundary, enforced
  at the database layer via row-level security (§12.9, R25).
- **FR-017**: At pairing and on every join/leave, the system MUST compute and cache
  `session_visibility_scope` — the intersection of artifacts every current participant can access —
  so Phase 4 publish-time checks are a cheap set-membership test (F9.1a).

**Shared open-thread tracking**

- **FR-018**: The system MUST maintain an Open Threads table, matching each utterance to an existing
  thread or opening a new one using continuation likelihood + topic embedding against an explicit
  threshold, with new-thread and merge/split handling; thread identity is owned by the session
  layer, not the triage router (F6.1a).
- **FR-019**: Open-thread state (and any per-thread counters) MUST be derived as a fold over the
  event log — never stored as a mutated value — so thread reassignment, merge, and split are safe and
  snapshots are a discardable cache (CX-1).

**Resilience & isolation**

- **FR-020**: Session state MUST be event-sourced such that a replacement worker reconstructs
  membership, merged transcript, and Open Threads from the log; recovery uses a symmetric per-worker
  reconciler, not a central supervisor (§6.3, §12.5).
- **FR-021**: Exactly one worker MUST hold a session's ownership lease; a monotonic fencing token
  MUST make split-brain / double-ownership impossible on failover (§12.5, R14).
- **FR-022**: All session, transcript, agent, and thread data MUST be tenant-isolated at the database
  layer via Postgres RLS; a missing app-layer predicate MUST NOT leak data (§12.9, R25).

**Phase boundary (explicit non-requirements)**

- **FR-023**: The system MUST NOT, in this phase, evaluate intervention gates, synthesize or publish
  mediation cards, or create Decision Records — those are Phase 4 (F8/F9/F10, §17). Phase 3 ends at a
  shared, attributed transcript + multi-agent consumption + open-thread tracking.
- **FR-024**: Consistent with the text-only invariant, no capability in this phase emits audio into a
  meeting (§3.2).

- **FR-025**: This phase MUST build the desktop app shell + on-device audio-capture stack (mic
  capture, VAD, streaming STT) deferred from Phase 2 to the pairing phase (§17, v2.8) — it is the
  prerequisite for merge, clock sync, and attribution. *(Owner-confirmed 2026-08-31.)*
- **FR-026**: This phase MUST be strictly plumbing: agents consume the shared merged feed but the
  system publishes **no** intervention to any panel — neither mediation cards nor private nudges.
  Both arrive with the Phase 4 mediation layer. Human-visible output in this phase is the shared,
  attributed transcript only (§17). *(Owner-confirmed 2026-08-31.)*

### Key Entities

- **Session**: A paired group of clients sharing one meeting, start to end; owns a lease + fencing
  token; its state is event-sourced.
- **Participant / Membership**: A human in a session, with join/leave times; carries pairing origin
  (calendar / team / code) and consent state.
- **Session Code**: A short-lived, rate-limited, scoped join credential with visible join events.
- **Consent Record**: The once-per-pair record of shared/not-shared terms and revocation state;
  internal pairs remembered, cross-workspace prompted each time.
- **Participant Agent**: An ephemeral agent bound to one human for one session, ACL-scoped to that
  owner's visible work.
- **Utterance**: A transcribed speech segment attributed to exactly one participant, stamped with a
  local monotonic timestamp, session clock offset, and error margin.
- **Merged Transcript**: The single time-ordered fold of all participants' utterances, carrying
  `order_confidence` and ambiguity marks.
- **Open Thread**: A tracked discussion thread; a derived fold over the utterance→thread mapping,
  never a mutated record.
- **session_visibility_scope**: The cached intersection of artifacts all current participants can
  access; recomputed on membership change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ≥ 90% of repeat internal meetings auto-pair with no user action (PRD G1).
- **SC-002**: Speaker attribution is correct for 100% of paired participants' utterances, verified by
  construction (no voice-based inference) (PRD G2).
- **SC-003**: A second participant joins an already-running session and appears in the shared feed in
  under 10 seconds from app start.
- **SC-004**: The merge preserves 100% of captured utterances — zero silent drops — across a
  representative multi-party session (coverage-before-correctness, §12.6).
- **SC-005**: Deleting all cached session snapshots and recomputing from the event log reproduces the
  identical membership, merged transcript, and Open Threads table (CX-1 property).
- **SC-006**: No raw audio is retained beyond the live transcription stream, verified by storage
  audit (§12.3).
- **SC-007**: In an adversarial test, no Participant Agent retrieves an artifact outside its owner's
  ACL, and `session_visibility_scope` exactly equals the true cross-participant intersection on every
  join/leave (§12.9, F9.1a).
- **SC-008**: The one-time consent card appears exactly once per new pair and never again for that
  internal pair; the capture indicator is visible 100% of the time capture is active (§7.2, §12.4).
- **SC-009**: On induced worker failover, a session resumes under a new owner with no double-published
  events and no lost utterances, within the recovery-time budget (§12.5).

## Assumptions

- **Builds on shipped phases.** Phase 1 (context layer: sync, indexing, retrieval, RLS isolation) and
  Phase 2 (grounded-answer core, provenance gating) are in place and reused; this phase adds the
  session/audio/pairing layer on top, not a reimplementation.
- **Audio-capture foundation is in scope** (owner-confirmed): the desktop app shell +
  mic/VAD/streaming-STT deferred from Phase 2 lands here, since merge, clock sync, and attribution
  depend on it.
- **No published intervention in this phase** (owner-confirmed): success is a correct shared
  substrate; both cards and private nudges are Phase 4.
- **Clock sync is spike-gated (AD-1).** The spec requires *correct, coverage-preserving ordering*, not
  a specific mechanism; whether that is full clock-sync or server-arrival ordering is decided by the
  AD-1 spike during planning.
- **STT reliability** follows the PRD's provider posture (streaming primary with failover behind a
  circuit breaker); the spec states the requirement (a reliable per-client transcript), not the
  vendor.
- **Scale target** is the PRD's stated envelope (up to ~500 concurrent sessions, §12) for
  non-functional sizing during planning — not a v1 launch gate.
- **Text-only remains absolute** (§3.2): nothing here emits audio into a meeting.
