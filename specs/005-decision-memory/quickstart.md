# Quickstart — validate Decision Memory end-to-end

Proves the feature works against **real Postgres with RLS on** (not mocks). Details of shapes/routes
live in [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Local run per `reference_falcon_local_run_gotchas` (web + real Supabase/Upstash; Voyage key; the
  PKCS#8/Auth.js/extensionAlias/tsx fixes).
- Migration `0004_decision_dismissed_at.sql` applied.
- Signed in to a workspace; a second workspace seeded for the isolation check.

## Scenario A — capture → confirm → answer (US1)

1. `POST /api/decisions` with a real decision (e.g. "Adopted Deepgram Nova as primary STT", rationale,
   options, `sourceRef:"#17"`). Expect **201 { id }**.
2. `GET /decisions?q=STT` → the record does **not** appear (still unconfirmed). ✅ FR-007.
3. `PATCH /api/decisions/{id} {action:'confirm'}` → **200**; DB shows `status=confirmed`,
   `confirmed_by`/`confirmed_at` set.
4. `GET /decisions?q=STT` → now appears. Ask Falcon "why did we choose Deepgram?" → **grounded, cited**
   answer; the citation links to `/decisions/{id}`. ✅ SC-001, FR-011.

## Scenario B — the four-state boundary (US2, the load-bearing check)

1. Seed one **unconfirmed** candidate about "switching STT to AssemblyAI" (`sourceRef:"#41"`).
2. Ask Falcon "are we changing our STT provider?" →
   - Answer must say **not settled** and link to the queue, exposing only "unconfirmed candidate from
     #41" — **no** rationale/decision text, **no** citation to it. ✅ FR-008, SC-004.
3. Ask about a topic with **no** record → "nothing on record" (silent), not a guess. ✅ FR-010.
4. With the confirmed Deepgram record **and** the unconfirmed AssemblyAI candidate both present, ask
   "what's our STT provider?" → answer grounds on Deepgram **and** notes a pending change (metadata
   only). It must NOT answer as if fully settled. ✅ FR-009 (settled + pendingChange co-occur).
5. Grep the response payload: assert zero unconfirmed content strings appear anywhere. ✅ SC-002.

## Scenario C — supersede (US3)

1. Confirm a new record "Adopted AssemblyAI as primary STT" that supersedes the Deepgram record
   (`PATCH … {action:'supersede', supersedesId}`).
2. Ask "what's our STT provider?" → answer reflects **AssemblyAI**; the Deepgram record never grounds
   and shows `superseded` with the chain in its detail view. ✅ SC-003.

## Scenario D — dismiss (US4)

1. `PATCH /api/decisions/{candidateId} {action:'dismiss'}` on an unconfirmed candidate.
2. It disappears from `listQueue` and from answer status surfacing. ✅ FR-005.
3. (Ship 2) Re-run the miner over the same source item → **no** duplicate candidate created. ✅ FR-005.

## Scenario E — tenant isolation (SC-005)

From workspace B, `GET /decisions?q=STT` and `PATCH` on workspace A's record id → no data / **404**.
Mirrors the feature-001 SC-003 RLS harness. ✅ FR-017.

## Scenario F — one embed per question (perf, R7)

Instrument the Voyage client (or Langfuse) while running one decision Q&A → assert **exactly one**
query-embedding call (not 2 or 3). ✅ Performance goal.

## Relevance-ceiling calibration (spike, gates Ship 1 exit)

Run the `@falcon/evals` `decision-ceiling` fixture (see [research.md](./research.md) R1): seeds a
labeled corpus, prints the distance distribution, and reports the chosen
`DECISION_RELEVANCE_MAX_DISTANCE` with precision/recall on positives vs. negatives. The value is
committed as config, not hardcoded blind.
