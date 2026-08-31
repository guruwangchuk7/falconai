# Phase 1 Data Model: Pairing

Entities for `specs/004-pairing`. Two stores, by design (PRD §12.3):

- **Postgres** (`@falcon/db`, Drizzle) — durable, tenant-scoped records. **All tables RLS + FORCE,
  keyed on `workspace_id`, granted to `falcon_app` (non-BYPASSRLS).**
- **Redis Streams** — the **live, event-sourced** session state (the source of truth during a
  session). Derived views are folds over the log (CX-1); snapshots are a discardable cache.
- **Nowhere** — raw audio. It exists only as an in-flight transcription stream (§12.3/R6).

Migration: `packages/db/src/drizzle/0003_pairing.sql` (+ grants). New tables extend `schema.ts`.

---

## Postgres tables (durable)

### `session`
The paired group sharing one meeting, start to end.
- `id` (uuid, pk), `workspace_id` (fk, RLS key)
- `session_key` (text) — origin key: calendar event id, team-auto id, or code id
- `origin` (enum: `calendar` | `team_auto` | `code`)
- `status` (enum: `active` | `ended`)
- `owner_fencing_token` (bigint) — highest fencing token issued for this session (see §12.5)
- `started_at`, `ended_at`, `retention_class` (per workspace policy)
- **Notes**: live merged transcript / open threads are **not** columns here — they live in Redis and
  are replayed; only finalized/durable summaries persist post-session (Phase 4 owns Decision Records).

### `session_membership`
One row per human per session.
- `id` (uuid, pk), `workspace_id`, `session_id` (fk), `user_id` (fk)
- `role_profile` (enum, F11) — for the participant's agent Context Pack
- `joined_at`, `left_at` (nullable — null = present), `join_origin` (enum as above)
- `consent_state` (enum: `granted` | `revoked`)
- **State transitions**: `joined → left`; on any change, `session_visibility_scope` is recomputed
  (FR-017) and a membership event is appended to the Redis log.

### `session_code`
Fallback join credential (F7.3).
- `id` (uuid, pk), `workspace_id`, `session_id` (fk)
- `code` (char(6), indexed), `expires_at` (TTL), `scope` (enum), `max_joins`, `join_count`
- `created_by` (user), `created_at`
- **Validation**: reject join if expired, over `max_joins`, out of scope, or rate-limited; every join
  attempt is logged with visibility (F7.3).

### `consent_pair`
Once-per-pair consent (§7.2). Keyed on the unordered pair of users.
- `id` (uuid, pk), `workspace_id` (nullable for cross-workspace), `user_lo` (uuid), `user_hi` (uuid)
  (canonical-ordered so the pair is unique regardless of who initiates)
- `is_cross_workspace` (bool) — if true, **never** treated as remembered (always re-prompt, §7.2)
- `granted_at`, `revoked_at` (nullable)
- **Rule**: internal pair with a live `granted_at` → auto-pair without prompt; cross-workspace → prompt
  every session regardless of history.

### `open_thread`
**Durable archive** of threads for a session (the *live* table is a Redis fold; this is the
end-of-session persisted snapshot for later phases/analytics). Tracking only — no gate state.
- `id` (uuid, pk), `workspace_id`, `session_id` (fk)
- `topic_embedding` (vector, voyage-code-4, 1024-dim; model+version stored per row per §12.9)
- `first_seen_seq` (bigint), `last_seen_seq` (bigint), `status` (enum: `open` | `merged` | `split`)
- `merged_into` (nullable fk) — for merge handling (F6.1a)
- **Invariant (CX-1)**: any per-thread counter is a recomputed fold over the utterance→thread mapping,
  never stored as a mutable integer. This table is a *cache of a fold*, safe to rebuild from the log.

### `session_visibility_scope`
Cached ACL intersection across current participants (F9.1a) — **compute-only in Phase 3**.
- `id` (uuid, pk), `workspace_id`, `session_id` (fk)
- `membership_version` (int) — bumped on every join/leave; the scope is stamped with the version it
  was computed for (stale scope is never used)
- `artifact_scope` (representation of the intersection — e.g. a compact set / bloom+exact hybrid for
  cheap set-membership; artifacts every current participant can access)
- `computed_at`
- **Rule**: recomputed on every membership change; Phase 4 reads it at publish time (not this phase).

### `session_event` (archive)
Optional durable archive of the Redis event log for finished sessions (offline diagnosis / merge-
quality feedback, §12.5 "persist raw per-client streams for the session lifetime"). Append-only.
- `id` (uuid, pk), `workspace_id`, `session_id`, `seq` (bigint), `type`, `payload` (jsonb),
  `created_at`. **No raw audio** — transcript/events only.

---

## Redis Streams (live, event-sourced — the source of truth during a session)

One stream per session: `session:{id}:events`. Append-only; every transition appends **synchronously
before** any downstream action (§12.3). Event types:

| Event | Payload (key fields) | Notes |
|-------|----------------------|-------|
| `member_joined` / `member_left` | user_id, role_profile, at, membership_version | triggers visibility recompute |
| `utterance_final` | user_id, text, client_seq, arrival_ts, error_margin_ms, order_confidence | the merged, attributed unit (F4/F5) |
| `transcript_gap` | user_id, from_seq, to_seq, reason | coverage gap marked, never dropped (§12.6) |
| `thread_opened` / `thread_matched` / `thread_merged` / `thread_split` | thread_id, utterance_seq, topic_embedding_ref | Open Threads fold (F6.1a) |
| `visibility_recomputed` | membership_version, scope_ref | F9.1a cache update |
| `coordinator_failover` | new_fencing_token, replay_ms | SLO alerting (§12.5) |

**Derived views (folds, never mutated — CX-1):**
- **Merged transcript** = ordered fold of `utterance_final` + `transcript_gap`, sorted by
  arrival-order key with ambiguous-order marks where error margins overlap.
- **Open Threads table** = fold of `thread_*` events over the utterance→thread mapping.
- **Membership** = fold of `member_*` events.

**Snapshots**: written every N events/seconds to `session:{id}:snapshot`; a **discardable cache** —
deleting all snapshots must be a correctness no-op (only recovery latency grows). Recovery = latest
snapshot + tail replay (§12.5 bounded-replay budget).

**Ownership**: `session:{id}:lease` (key + TTL, heartbeat-renewed) + a monotonic **fencing token**;
the lease holder is the only writer/publisher; every panel push carries the token (§12.5/R14).

---

## Ephemeral (in-worker, not persisted)

### Participant Agent
One per paired human, an **in-worker async task** (§6.3, R2) — not a table.
- Bound to `user_id` + `role_profile`; compiled with the F3 **Context Pack** (agenda, Role Profile,
  Work Digest, open PRs/tickets, confirmed decisions) via the shipped Phase-1 retrieval.
- Retrieval is ACL-scoped to its owner via `withTenant` on `falcon_app` (RLS). **Phase 3: consumes
  the merged feed; produces no published output** (FR-026).
- Late joiner → agent provisioned mid-session, backfilled with a compressed transcript (F3).

---

## Entity relationships

```
workspace 1───* session 1───* session_membership *───1 user
                  │                    │
                  ├──* session_code    └── (on change) ──> session_visibility_scope (1 per session, versioned)
                  ├──* open_thread (archive of a Redis fold)
                  └──* session_event (archive; NO raw audio)

consent_pair: (user_lo, user_hi[, workspace]) unique — gates auto-pair vs prompt

Redis  session:{id}:events  ──fold──>  {merged transcript, open threads, membership}
       session:{id}:snapshot (discardable cache)   session:{id}:lease (+ fencing token)
```

## Isolation & retention rules (enforced, not prose)

- Every Postgres table: **RLS + FORCE**, `workspace_id` predicate at the DB layer; `falcon_app`
  lacks `BYPASSRLS` and does not own the tables (§12.9/R25).
- `topic_embedding` stores model+version per row; embedding space is part of the partition key so a
  cross-model query can't mix vector spaces (§12.9).
- **Raw audio**: never persisted (Postgres, Redis, or disk). Transcripts encrypted at rest, retention
  per `retention_class` (§12.3).
- Cross-workspace sessions: `consent_pair.is_cross_workspace = true` → always prompt (§7.2).
