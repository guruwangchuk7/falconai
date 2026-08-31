# Phase 0 Research: Pairing

Resolves the NEEDS-CLARIFICATION / architecture-decision items for `specs/004-pairing`. Two of these
(AD-1, AD-2) are PRD §22 Architecture-Decisions-Pending the constitution requires resolving by spike
in this phase before dependent code. Each entry: **Decision · Rationale · Alternatives considered ·
Spike to confirm** (where a decision is provisional pending a build-time spike).

---

## R1 — AD-1: Clock sync vs. server-arrival ordering *(PRD §22 AD-1, F5.3, R5)*

**Decision**: Adopt **server-arrival ordering** as the Phase-3 baseline. The session worker orders
utterances by the time it receives each **finalized** utterance, softened by a bounded per-client
reorder buffer (2s default, up to ~5s for high-variance links) sized from measured RTT jitter. Each
utterance carries an **error margin** derived from that client's RTT variance; when two utterances'
margins overlap, their relative order is marked **ambiguous** and `order_confidence` drops. **Do not
build** the full distributed clock-sync subsystem (per-utterance offset estimation, semantic-adjacency
sequencer) in Phase 3.

**Rationale**: The elaborate clock-sync machinery exists to answer "who responded to whom" for
Phase-4 mediation timing. **Phase 3 has no gate that consumes fine-grained order** — it only needs a
coherent, coverage-complete transcript and thread continuity. Server-arrival ordering + RTT-variance
error margins delivers exactly F5.3's observable behavior (ambiguous-on-overlap) with a fraction of
the complexity, and propagates `order_confidence` (§12.5) so Phase 4 can tighten later. This is the
"server-arrival ordering may delete the whole subsystem" outcome the PRD hoped for, taken
conservatively (we keep the confidence signal, we drop the subsystem).

**Alternatives considered**: (a) Full NTP-style per-client clock-offset estimation — rejected as
premature; nothing in Phase 3 reads it, and §12.5 explicitly defers the continuous sequencer. (b)
Naive first-arrival with no error margin — rejected: loses the ambiguity signal F5.3/R5 require, would
force a false order onto genuinely-concurrent speech.

**Spike to confirm (blocks `merge.ts`)**: On 2–3 real paired sessions across asymmetric links,
measure ordering-error rate of server-arrival + buffer vs. hand-labeled truth. Pass bar: ambiguous
pairs are correctly flagged and no *confident* order is wrong. If real meetings show confident
mis-orders the confidence signal misses, escalate to the deferred semantic sequencer — but only then.

---

## R2 — AD-2: LangGraph vs. in-worker async tasks *(PRD §22 AD-2, §6.3)*

**Decision**: **Defer LangGraph.** In Phase 3, Participant Agents are **in-worker async tasks**
(Promise-based fan-out/fan-in inside the session worker, per §6.3) — no orchestration graph. Re-open
AD-2 at Phase 4, when the Coordinator's gate→poll-agents→synthesize flow introduces real multi-step
stateful orchestration.

**Rationale**: Phase 3 is strictly plumbing: agents *consume* the merged feed and retrieve context;
there is no Coordinator, no gates, no synthesis, no inter-agent choreography. A graph framework would
add a dependency and a failure surface with nothing to orchestrate. §6.3 already prescribes "agents as
in-worker async tasks," so plain async matches the intended architecture and keeps the hot path
in-process.

**Alternatives considered**: (a) Adopt LangGraph now for "future-proofing" — rejected (CX-2 spirit:
don't build orchestration before there's a workflow; premature framework lock-in). (b) A bespoke
mini-state-machine — rejected as unnecessary for fire-and-collect fan-out.

**Spike to confirm**: none needed for Phase 3 (decision is *not to adopt*). Record the re-evaluation
trigger in the Phase 4 spec: when Coordinator synthesis + gate polling lands, benchmark LangGraph vs.
hand-rolled orchestration against the §12.7 golden set.

---

## R3 — STT streaming: provider, failover, calibration *(§12.9, §12.8, F4)*

**Decision**: New `packages/stt` thin provider interface. **Deepgram Nova** streaming primary,
**AssemblyAI** failover, behind a **circuit breaker**. Failover unit = the **utterance boundary**
(finish/abandon in-flight, reconnect next utterance to fallback); abandoned utterance audio is re-sent
from the client's addressable local buffer. Trigger counts **latency as degradation** (time-to-final
relative to utterance end), treats socket silence as its own failure, and is **one-way within a
session** (no failback → no flapping). Confidence scores are **calibrated per-provider** (or not
thresholded on — pick one explicitly); word timestamps are defined against **our own audio sequence
numbers**, vendor timings advisory. Total STT loss → local buffer + explicit marked gap (F5.4).

**Rationale**: Directly implements §12.9's circuit-broken-dependency spec. STT is "every spoken word,"
so its failure is total input loss, not graceful degradation — the breaker + failover is mandatory,
not optional. Sequence-number-anchored timestamps prevent a provider switch from injecting a
discontinuity into the very ordering data R1 depends on.

**Alternatives considered**: Single provider — rejected (§12.8: judgment-light layer must still have
failover; a rate-limit/outage would take the product down). Failback within session — rejected
(hysteresis/flapping).

**Spike**: build the **fault-injection shim** (kill socket, inject latency, garble finals) first and
exercise failover in tests — "the failover path isn't first exercised in a live meeting" (§12.9).

---

## R4 — On-device capture: cpal + Silero VAD, raw-audio handling *(§12.2, §12.3, F4)*

**Decision**: Tauri 2 Rust core uses **`cpal`** for mic capture and **Silero VAD (ONNX Runtime)** to
gate speech. Only VAD-passed speech frames are streamed to STT; **silence is dropped at the edge**.
Raw audio is **never written to disk** and never leaves the device except as the live STT stream. A
bounded, **sequence-addressable local ring buffer** holds recent frames for reconnect/failover re-send
only, then is discarded. An **always-visible capture indicator** is driven by the Rust capture state.

**Rationale**: VAD gating is one of the two things carrying the <$2/hr COGS (§12.2 — without it STT
cost ~7×). Raw-audio-never-stored is a constitutional boundary (§12.3/R6). The ring buffer is what
makes STT failover lossless (R3) and network-loss recoverable (§12.3) without persisting audio.

**Alternatives considered**: Electron — rejected per §13 (~150MB vs ~10MB, battery, no Rust audio).
WebAudio capture in the webview — rejected: worse control over device/latency and buffering than
native `cpal`; VAD in Rust keeps audio off the JS heap.

**Spike**: confirm Silero-ONNX VAD latency fits the ~100ms mic→stream budget on target hardware
(macOS first).

---

## R5 — Transport: WebSocket in, SSE out *(§13, §6.3)*

**Decision**: Client → session worker over **WebSocket** (bidirectional: VAD-gated audio frames +
control/events). Worker → panel over **SSE** for state push (transcript, membership, thread updates).
Session worker is **Fastify** + `ws`. Sessions are pinned to a worker by **consistent hash on
`session_id`** (§6.3); the hot path (ingest → merge → thread-match) stays in-process.

**Rationale**: Matches §13 exactly (WebSocket audio+events, SSE panel push). SSE for one-way panel
push is simpler and more proxy-friendly than a second WS; WS is reserved for the audio uplink that
needs bidirectionality and backpressure.

**Alternatives considered**: WebRTC — rejected: we're not doing peer media, just client→server
transcription; WebRTC's NAT/media stack is overkill. All-WebSocket for panel too — rejected: SSE is
the lighter fit for server→panel state and already the PRD choice.

---

## R6 — Event sourcing, ownership, recovery *(§12.3, §12.5, CX-1, R14)*

**Decision**: Live session state = **append-only Redis Stream** per session (membership changes,
utterances, thread transitions). Every transition appends **synchronously before** any downstream
action. Derived state (merged transcript, Open Threads, turn/thread membership) is **computed by
replay** from the latest snapshot + tail — **never mutated in place** (CX-1). Snapshots every N
events/seconds are a **discardable cache** (deleting all snapshots must be a correctness no-op).
Ownership = **Redis lease key + TTL renewed on heartbeat** with a **monotonic fencing token**
incremented on each claim; every panel push carries the token and clients reject lower-token messages
→ split-brain impossible. Recovery is a **symmetric per-worker reconciler** (each worker reconciles
owned-vs-held leases and claims the delta), **not** a central supervisor. AOF fsync tuned so "written"
= "durable within the recovery window." A `coordinator_failover` event (session id + replay duration)
is emitted for SLO alerting.

**Rationale**: Verbatim §12.3/§12.5 mechanisms. CX-1 collapses three consistency hazards (worker
recovery, thread-counter drift, stale state) into one testable property. Fly.io machine auto-restart
does **not** meet the recovery SLO (boot is tens of seconds) — the reconciler is what meets it (§6.3).

**Alternatives considered**: Snapshot-as-source-of-truth — rejected (CX-1: mutated counters silently
drift; a crash one turn from a thread transition must not reset it). Central supervisor for failover —
rejected (§6.3: single point of failure for the failover path itself).

---

## R7 — Pairing mechanisms & consent *(F7.1–F7.3, §7.2)*

**Decision**: Three join paths. (1) **Calendar match (default, F7.1)** — both clients read Google/MS
Calendar via `@falcon/integrations`; a shared event ID becomes the session key. (2) **Team auto-pair
(F7.2)** — same-workspace members speaking within a 90s window get a one-tap "Join session with X?"
prompt. (3) **Session code (F7.3)** — 6-char code with **TTL, join rate-limit, scope, and visible join
events**. **Consent** is stored **once per person-pair** (`consent_pair`): internal pairs remembered
and auto-paired thereafter; **cross-workspace always prompts** (never remembered). The one-time card
names shared (transcript, agent stances) vs. not-shared (private nudges, raw audio) + revocation.

**Rationale**: Direct F7/§7.2 implementation. Consent at session scope (once per pair) is both the
PRD's UX choice and the legal posture (§12.4); the code's TTL/rate-limit/scope bound a leaked code.

**Alternatives considered**: Per-meeting consent — rejected (§7.2: friction, and the PRD explicitly
chose once-per-pair). Open-ended codes — rejected (F7.3: a code grants transcript-feed access).

---

## R8 — Open-thread tracking (tracking only) *(F6.1a, F6, CX-1)*

**Decision**: The session worker owns the **Open Threads table**. The triage router emits a
**`continuation_likelihood`** score + the **topic embedding** (voyage-code-4) per utterance — **a
score, never a thread id** (an id implies authority the cheap classifier shouldn't hold, F6.1a). The
worker matches each utterance to an Open Thread against an explicit threshold, with new-thread and
merge/split handling; **per-thread counters are recomputed folds, never incremented integers** (CX-1,
so merge/split can't orphan a counter). **No gates, no escalation, no synthesis** — Phase 3 stops at
the table. (The Gate-2 turn definition and gate evaluation are Phase 4.)

**Rationale**: Builds the exact data structure Phase 4 reads, with thread identity correctly located
in the session/Coordinator layer and derived-state discipline baked in from the start.

**Alternatives considered**: Router owns thread ids — rejected (F6.1a: keeps router stateless and
avoids distributed thread-consensus later). Incremental counters — rejected (CX-1).

---

## R9 — `session_visibility_scope` (F9.1a precondition, tracking only) *(F9.1a, §12.9)*

**Decision**: At pairing — and on **every join/leave** — compute `session_visibility_scope` = the
**intersection** of artifacts every current participant can access, using the shipped Phase-1 ACL
model, and cache it (per session, version-stamped on membership change). Phase 3 **computes and
maintains** this; it does **not** publish anything through it (no cards). It exists so Phase 4's
publish-time ACL check is a cheap set-membership test.

**Rationale**: F9.1a says compute-at-pairing precisely so publish-time is O(1). Building it now (when
membership logic is being written anyway) is the natural home; deferring it to Phase 4 would mean
retrofitting membership hooks. Per-agent retrieval ACLs remain enforced at the DB layer (RLS) —
`session_visibility_scope` is the *cross-participant* intersection, a distinct, additional structure.

**Alternatives considered**: Compute lazily at publish time (Phase 4) — rejected (F9.1a explicitly
prescribes cache-at-pairing; also splits membership logic across phases).

---

## Summary of decisions

| # | Area | Decision | Spike gates code? |
|---|------|----------|-------------------|
| R1 | AD-1 clock sync | Server-arrival ordering + error margins; defer full subsystem | Yes → `merge.ts` |
| R2 | AD-2 orchestration | Defer LangGraph; in-worker async tasks | No (not-adopt) |
| R3 | STT | `packages/stt`: Deepgram→AssemblyAI, breaker, utterance-boundary failover | Yes → fault shim first |
| R4 | Capture | cpal + Silero VAD (ONNX); raw audio never stored; ring buffer | Yes → VAD latency |
| R5 | Transport | WS in / SSE out; Fastify; consistent-hash session pinning | No |
| R6 | Event sourcing | Redis Streams; lease + fencing token; symmetric reconciler recovery | No |
| R7 | Pairing/consent | Calendar / team-auto / code(TTL+rate+scope); consent once-per-pair | No |
| R8 | Open threads | Worker-owned table; router emits score not id; recomputed folds | No |
| R9 | Visibility scope | ACL intersection at pairing/join/leave; compute-only (no publish) | No |

All NEEDS CLARIFICATION resolved. AD-1 and AD-2 decided (AD-1 provisional pending its build-time
spike; AD-2 not-adopt for Phase 3). Ready for Phase 1 design.
