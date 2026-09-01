# Phase 1 Data Model — Decision Memory

The `decision_record` table already exists with the full F10.1 shape. This feature adds **one column**
and defines two in-memory (non-persisted) shapes used by the answer path.

## 1. `decision_record` — existing table, one additive change

Existing columns (from `0001_init.sql` / `schema.ts`): `id`, `workspace_id`, `title`, `decision`,
`options (jsonb)`, `rationale`, `dissent`, `owner_user_id`, `status`, `supersedes_id`, `confirmed_by`,
`confirmed_at`, `source_ref`, `revisit_at`, `embedding (vector 1024)`, `embedding_model`,
`embedding_version`, `created_at`. Hash-partitioned by `workspace_id` (16); RLS FORCED; HNSW cosine
index on `embedding`; btree `(workspace_id, status)`.

### Change: add `dismissed_at`

| Column | Type | Notes |
|---|---|---|
| `dismissed_at` | `timestamptz NULL` | Set when a reviewer dismisses an unconfirmed candidate. `NULL` = not dismissed. **Orthogonal** to `status` (do not add a status enum value). |

Migration `packages/db/drizzle/0004_decision_dismissed_at.sql`:
`ALTER TABLE decision_record ADD COLUMN dismissed_at timestamptz;` (cascades to partitions). Optional
partial index `create index decision_dismissed_idx on decision_record (workspace_id) where dismissed_at
is not null;` — only if queue queries need it. Drizzle `schema.ts`: add
`dismissedAt: timestamp('dismissed_at', { withTimezone: true })`.

### Lifecycle & invariants

```
create ──► unconfirmed ──confirm──► confirmed ──superseded-by-new──► superseded
                │
              dismiss (sets dismissed_at; status stays 'unconfirmed')
```

- **Embedding**: set at **create** (manual + miner), not at confirm. `embedding_model` /
  `embedding_version` stamped with the pinned Voyage id.
- **Retrievability (grounding)**: `status = 'confirmed'` **only**. Unconfirmed, superseded, and
  dismissed never ground. (`searchDecisions` unchanged.)
- **Matchability (status surfacing)**: `status = 'unconfirmed' AND dismissed_at IS NULL`, within the
  relevance ceiling (R1).
- **Supersede**: new confirmed record sets `supersedes_id` → old row's `status = 'superseded'`. Old row
  excluded from retrieval; chain shown in the detail view.
- **Idempotency**: confirm on already-confirmed = no-op; supersede on already-superseded = no-op; state
  never regresses (FR-006).
- **Validation**: `title` required; `decision` required for a *confirmable* record (a candidate may be
  sparse but must gain a decision before confirm); `source_ref` optional (manual entries may lack one).

## 2. `DecisionStatus` — answer metadata (in-memory, not persisted)

Attached to an `Answer` by the resolver (R4). Carries **no** unconfirmed content.

```
DecisionStatus {
  settled?: {
    decisionId: string
    changed: boolean          // true when the grounded record has a supersedes_id
  }
  pendingChange?: PendingRef  // present alongside `settled` when an unconfirmed candidate also matches
  proposed?: PendingRef       // present (without `settled`) when ONLY an unconfirmed candidate matches
}
PendingRef {
  count: number
  sourceRefs: (string | null)[]   // e.g. "#482"; null when a manual entry had no source
  queueLink: string               // "/decisions?tab=queue" (a link, not content)
}
```

- Exactly one of {`proposed` alone} or {`settled` [± `pendingChange`]} or {omit entirely} per answer.
- `none` state = `decisionStatus` omitted from the answer.
- **Boundary rule**: only `count`, `sourceRefs`, `queueLink` may originate from an unconfirmed record.

## 3. `UnconfirmedMatch` — internal shape from `matchUnconfirmedCandidates`

```
UnconfirmedMatch { id: string; sourceRef: string | null; createdAt: string; distance: number }
```

Deliberately **excludes** `decision`, `rationale`, `options`, `title`. This narrow type is the
type-level guarantee behind FR-008.

## 4. Queue item — read shape for the Unconfirmed Queue UI

A projection over `decision_record where status='unconfirmed' and dismissed_at is null`:
`{ id, title, decision, rationale, options, sourceRef, createdAt, origin: 'manual' | 'suggested' }`.
Note the **UI queue** (owner acting on their own workspace's candidates) may show content — that is a
person reviewing to confirm, which is allowed. The content boundary applies to **answers**, not to the
confirm UI.
