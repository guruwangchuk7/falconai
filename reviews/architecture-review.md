# Falcon PRD — Architecture Review (v2.5)

Reviewer: Claude Code (`/plan-eng-review`), interactive with Guru · 2026-08-28
Target: `PRD.md` v2.5. Companion: [`review-test-product.md`](./review-test-product.md).

> The PRD is a fixed source-of-truth artifact; nothing here edits it. Each RESOLVED item states
> what to fold into the PRD and where.

---

## Cross-cutting principles (EUREKA — apply everywhere)

### CX-1 — No derived state is stored as a mutable value
Three findings (A1 snapshots, A5 turn counters, A7 card freshness) resolved to one rule. State
it once in §12.3 and reference it everywhere gate/thread/card state is defined:

> **Turn counters, gate status, open-thread membership, and mediation cards are folds over the
> event log — recomputed and version-stamped, never incremented, mutated, or maintained in
> place. A derived value's version (the log position it was computed from) is part of its
> identity.**

Falls out for free: snapshots are a discardable cache (deleting them all is a no-op for
correctness, A1); thread reassignment can't drift a counter (A5); card staleness is detectable
by version (A7).

### CX-2 — Escape hatches amplify the failure they bypass (from P1)
Any override keyed on a **symptom** (spend, latency, error rate) hands extra resources to
whatever is malfunctioning. Audit every override in the PRD against this. Worked examples:
- P1 cost headroom keyed on spend would feed budget to an over-firing router → rejected in favor
  of an engagement-keyed / pooled model (see product doc).
- F7.1's 1-turn fast-path IS symptom-keyed (`premise_challenged`), and its **corroboration
  requirement** (a second independent signal) is exactly what stops it amplifying a false
  positive. Keep that guard; it's the template for any symptom-keyed path.
- F9.5 "Ask Falcon" is user-initiated (human in the loop), so it's safe by construction.

---

## Resolved architecture findings

### A1 — Session-worker failover: respawn + recovery budget
Fencing tokens (§12.5) settle *who may publish*, not *who restarts a dead worker*.
- **Symmetric reconciler, no central supervisor** (a supervisor is a SPOF for the SPOF). Every
  worker binary runs a reconcile loop comparing `owns` (hash ring × membership) vs `holds`
  (leases) and claims the delta. Reframe: "an already-running worker notices it now owns 123,"
  not "respawn a worker for 123." ~couple hundred lines, in the worker.
- **Fly.io auto-restart does NOT cover this** (boot+app-start = tens of seconds). Platform
  primitives help only if the ring rebalances onto already-running workers = the reconciler.
- **Recovery budget, explicit:** ~2–3s lease TTL + ~1s heartbeats + ~1s membership propagation
  → ~5s left for replay.
- **The real gap is checkpointing, not respawn.** Collides with §12.3's stated "event-sourced,
  **not snapshotted** … computed by replaying the log." Fix (standard): snapshot = derived,
  discardable memoized fold; log stays sole source of truth. Wording → "…from the most recent
  snapshot." Spec the CX-1 invariant: deleting every snapshot is a no-op for correctness.
- **Client buffer relaxes the SLO:** §12.3/§16 buffer-on-network-loss is never tied to the
  *failover* budget. Spec a 60s buffer covering coordinator gaps → a 10s outage costs latency,
  not transcript; the SLO stops being load-bearing.
- **Re-derive the 10s** from a user-perceived threshold, not a round number.
- **PRD edits:** §6.3, §12.3, §12.5, and the SLO.

### A2 — Tenant isolation vs pgvector ANN (blocker-class R25)
Keep RLS as the correctness boundary; make partitioning carry performance.
- **Hash-partition `workspace_id` into 32–64 buckets**; dedicated LIST partitions for whale
  tenants. Partitioning = performance; RLS = correctness; neither substitutes.
- Exact sequential kNN on small partitions; HNSW only where partition size warrants (long tail
  gets 100% recall free).
- **CI assertion:** `EXPLAIN ANALYZE` through the real RLS path asserts `Partitions removed`,
  not a literal ID — qual is `STABLE`, pruning is runtime and degrades silently.
- **Pooling rules (where R25 actually breaks):** `SET LOCAL` in an explicit txn; app role
  without `BYPASSRLS`; app role not the table owner, or `FORCE ROW LEVEL SECURITY`.
- **Confirm pgvector ≥0.8** (iterative index scans fix truncated result sets — changes the
  problem). Rejected: dedicated vector store now (its namespace isolation is app-enforced, the
  exact property §12.9 exists to eliminate).
- **PRD edits:** §12.9, §12.10/Open Q4, §13 (pin pgvector ≥0.8).

### A3 — Prompt-injection threat model narrower than its confidence
Provenance-gating (F7.2) closes fabricated citations + ACL-bypass; stance/nudge free text and
omission/steering are open. Grounding the pointer ≠ constraining the prose.
1. **Split the control plane off the hijackable channel:** structured stance for the gate (enum
   + confidence + cited IDs); free text only for human display. Biggest single reduction.
2. **Omission detection, near-free:** diff the retrieval set vs the cited set (both already in
   memory); flag high-relevance retrieved artifacts the agent dropped. No second model, no
   latency.
3. **Trust *tiers* at ingestion** (schema change): PR comment body = attacker-controlled;
   team ticket = not; commit diff = between. Keep untrusted text out of instruction position.
4. **Narrow the R20/F7.2 claim:** "closes fabrication + ACL-bypass; steering + omission
   residual, monitored." Rejected: second-model manipulation classifier (itself injectable,
   adds latency, unfalsifiable). Eval notes → product doc (negative controls, synthetic omission
   corpora).
- **PRD edits:** F7, F7.2, F8, §12.7, R20, §14 (trust-tier on artifact chunks).

### A4 — Embedding model + dimension — RESOLVED (voyage-code-4, but don't hardcode)
`vector(1536)` (§14) matched neither §13 candidate. Resolution:
- **Pick `voyage-code-4`** (not voyage-code-3 — legacy); §14 → `vector(1024)`.
- **Never write a model name into the schema.** Store `embedding_model` + `embedding_version`
  per row, and make the **embedding space part of the A2 partition key** — querying across two
  models' vectors returns silently-wrong similarity with no error. With dual-write / shadow-read,
  re-embedding becomes a background job, not a migration event. voyage-4 shares 1024 defaults with
  Matryoshka truncation, so 1024 isn't a dimension lock-in either.
- **Verify the model assumption with an eval, don't accept it:** the corpus is mostly prose
  *about* code (PR descriptions, tickets, review comments), not code itself — `voyage-4-large`
  may beat the code-specialized model. Settle with a recall@k eval built from the §12.7 golden
  set (~a day, reusable for every future model). Put `rerank-2.5` (often more precision than an
  embedding swap, at latency cost vs the 1.5s budget) and `voyage-context-4` (chunk-context loss
  on long PRs) in the same eval.
- **PRD edits:** §13 (voyage-code-4 + rerank in the eval loop), §14 (`vector(1024)` +
  per-row `embedding_model`/`embedding_version`; embedding space in the partition key).

### A5 — Thread identity ownership (Coordinator owns; router emits a typed score)
- Coordinator owns identity (option 2's latency win is ~zero in-process, §6.3).
- **Stronger reason:** the router is the component to split out later (cheap model, high volume,
  different scaling curve). Stateless → extraction is a config change; a match cache →
  distributed consensus. Statelessness buys the future move free.
- **Type the router's judgment correctly:** emit `continuation_likelihood` + topic embedding,
  **never `open_thread_id`**. **Delete the field from F6.1**, don't deprecate it.
- Coordinator assignment must spec: match threshold, explicit new-thread branch, and
  **merge/split** (a merge orphans a Gate-2 counter).
- **Ties to CX-1:** revisable assignment ⇒ counters derived from the utterance→thread mapping,
  never incremented. State in §6.1/§8: no gate state stored as a mutable integer.
- **PRD edits:** F6.1, F8/§6.1.

### A6 — STT failover unit + trigger + normalization
- **Utterance-boundary failover** (F4.5), made strictly better by the A1 addressable buffer:
  re-send the abandoned utterance's raw audio from the client buffer to the fallback → real
  transcript a couple seconds late, not a permanent gap. **Schema:** buffer addressable by
  sequence number / byte offset (server requests a range), not a blind ring buffer. Into §16 now.
- **The bigger hole is the trigger:** (1) latency counts as degradation (measure time-to-final
  vs utterance end, not socket RTT); (2) no failback within a session (one-way switch, kills
  flapping); (3) socket silence is its own case.
- **Normalization > interim/final:** confidence scores aren't comparable across vendors
  (calibrate per-provider or don't threshold on confidence — pick one); timestamps differ in
  offset convention (define against your own audio sequence numbers, vendor timings advisory —
  this is the data clock-sync depends on).
- **Build item:** fault-injection shim in the provider interface (kill socket, inject latency,
  garble finals) — else the failover path debuts in a live meeting.
- **PRD edits:** §12.9, §15/§16, provider interface; shim → test plan.

### A7 — Publish race (card ready vs pause) — hold, bounded by thread version
- Hold to next pause, **bounded**: in heated arguments pauses get rare when the card matters; a
  card about a disagreement that ended 90s ago is worse than nothing.
- **Reuse CX-1:** stamp each card with the thread version it was folded from; publish only if
  the thread hasn't advanced > N utterances; else discard + re-synthesize, abandon after K.
- **Reframe:** if the race is common the bug is eligibility firing at moment-of-need, not
  publish timing — respond with **speculative synthesis on rising thread heat** (wasted
  synthesis = cents; missed card = the product).
- **Pause-detection subtlety:** publish trigger needs a shorter silence threshold than pause
  confirmation, or cards land a beat late.
- **PRD edits:** §12.1/§6.3, F9.4.

### A8 — Missing schema tables (accepted fix)
Add §14 tables for the F9.1a redaction audit log, the §12.7 eval/golden set, and
`coordinator_failover` events. Named first-class in prose, absent from the model.
