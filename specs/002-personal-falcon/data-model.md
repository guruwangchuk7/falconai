# Phase 1 Data Model: Personal Falcon

New entities are **tenant-scoped** (RLS + FORCE ROW LEVEL SECURITY, `workspace_id` isolation
policy, granted to `falcon_app`) exactly like the Phase 1 tenant tables. Retrieval reuses existing
`artifact`, `artifact_chunk`, `decision_record`, `user`, `workspace`, `membership`, `connection`.

## New entities

### conversation
A thread of questions/answers for follow-up context (FR-011).
- `id` (uuid, pk)
- `workspace_id` (uuid, → workspace) — RLS key
- `user_id` (uuid, → user) — owner; private to this user
- `title` (text, nullable) — derived from the first question
- `created_at`, `updated_at` (timestamptz)

### question
- `id` (uuid, pk)
- `conversation_id` (uuid, → conversation)
- `workspace_id`, `user_id` (RLS + ownership)
- `text` (text) — the natural-language question
- `kind` (enum: `qa` | `summary`) — a targeted prep summary is a scoped question
- `scope` (jsonb, nullable) — for `summary`: `{ topic?, from?, to? }`
- `asked_at` (timestamptz)

### answer
- `id` (uuid, pk)
- `question_id` (uuid, → question)
- `workspace_id` (RLS)
- `status` (enum: `grounded` | `no_grounded_answer`)
- `generated_text` (text, nullable) — the rendered answer (null when `no_grounded_answer`)
- `model`, `model_version` (text) — pinned model identity (Constitution V)
- `generated_at` (timestamptz)
- `edited_text` (text, nullable), `edited_at` (timestamptz, nullable) — user correction is
  authoritative (FR-009), same pattern as `work_digest`
- `data_as_of` (timestamptz) — last successful sync reflected (FR-014 freshness)

### answer_citation
Binds a claim in an answer to a real, ACL-checked source (Constitution II). An answer with
`status=grounded` MUST have ≥1 citation; every rendered claim maps to ≥1 row here.
- `id` (uuid, pk)
- `answer_id` (uuid, → answer)
- `workspace_id` (RLS)
- `artifact_id` (uuid, → artifact) — the cited artifact
- `chunk_id` (uuid, → artifact_chunk, nullable) — the specific evidence span
- `claim_ref` (text) — which claim/sentence this supports (index or short quote)

### query_event
Minimal event for the solo-retention metric (SC-005). No answer content.
- `id` (uuid, pk)
- `workspace_id`, `user_id`
- `kind` (enum: `qa` | `summary`)
- `occurred_at` (timestamptz)

## Validation rules (from requirements)

- **Grounding invariant (FR-003, FR-004, Constitution II):** `answer.status=grounded` ⇒ every
  rendered claim has ≥1 `answer_citation` whose `artifact_id` was in the retrieved, ACL-checked
  candidate set for that question. If zero claims survive verification ⇒ `status=no_grounded_answer`,
  `generated_text=null`.
- **Isolation (FR-006, Constitution III):** all reads/writes go through `withTenant`; RLS FORCE on
  every table above; `falcon_app` (non-BYPASSRLS) is the runtime role.
- **Decisions (FR-007):** when a citation is a `decision_record`, it MUST be a *confirmed* record;
  unconfirmed/superseded records are not retrievable as decisions.
- **Ownership:** `conversation`/`question`/`answer` are private to `user_id` within the workspace —
  another member of the same tenant cannot read another user's conversations (personal agent).
- **Edit authority (FR-009):** if `edited_text` is set, it — not `generated_text` — is what the
  system surfaces and reuses downstream.

## Relationships

```
workspace 1───* conversation 1───* question 1───1 answer 1───* answer_citation *───1 artifact
   │                                   │                                            (└─* artifact_chunk)
   └──* query_event                    └─ kind=summary carries scope{topic,from,to}
```

## Reused (Phase 1) — no change

`artifact`, `artifact_chunk` (embeddings), `decision_record` (confirmed only), `user`, `workspace`,
`membership`, `connection`. Retrieval path: query embedding → pgvector ANN over `artifact_chunk` →
Voyage rerank → ACL/tenant filter (already enforced).
