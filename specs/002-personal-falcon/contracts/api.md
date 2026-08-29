# Contracts: Personal Falcon Q&A API

All endpoints are **authenticated** (Auth.js session) and **tenant-scoped** — the workspace + user
come from the session, never the request body. All data access runs through `withTenant` on the
`falcon_app` role. Text-only; responses stream where noted.

## POST /api/falcon/ask

Ask a grounded question; streams the answer, then finalizes with verified citations.

**Request**
```json
{ "question": "What did I do for authentication, and does it match the architecture?",
  "conversationId": "uuid | null" }
```

**Response**: `text/event-stream` (streamed tokens) → terminal JSON event:
```json
{
  "answerId": "uuid",
  "conversationId": "uuid",
  "status": "grounded",
  "claims": [
    { "text": "You added the GitHub provider and configured the auth callbacks.",
      "citations": [ { "artifactId": "uuid", "title": "feat(web): Auth.js GitHub connect",
                       "url": "https://github.com/.../commit/…", "type": "commit" } ] }
  ],
  "dataAsOf": "2026-08-29T08:32:00Z"
}
```
When nothing grounds the answer:
```json
{ "answerId": "uuid", "status": "no_grounded_answer",
  "message": "I don't have anything in your synced work that answers this." }
```

**Guarantees (tested):**
- Every `claims[].citations[].artifactId` was in the retrieved, ACL-checked candidate set for this
  question (Constitution II). No claim renders without a resolvable citation.
- No artifact the user cannot access appears in any citation (Constitution III).
- `decision_record` citations are confirmed records only.
- Errors: `401` (no session), `429` (rate-limited, reuse Phase 1 limiter), `503` (LLM/embeddings
  provider down → honest degraded message, never a fabricated answer).

## POST /api/falcon/summary

Targeted prep summary (a `kind=summary` question with a scope). Same grounded path + streaming.

**Request**
```json
{ "topic": "authentication", "from": "2026-08-01", "to": null, "conversationId": null }
```
**Response**: same shape as `/ask` (`status`, `claims[]`, `dataAsOf`).

## GET /api/falcon/conversations

List the current user's conversations (private to the user within the tenant).
```json
[ { "id": "uuid", "title": "authentication work", "updatedAt": "…" } ]
```

## GET /api/falcon/conversations/{id}

Read one conversation's questions + answers (with citations). `404` if not owned by the caller.

## PATCH /api/falcon/answers/{id}

Correct an answer/summary; the edited text becomes authoritative (FR-009).
**Request** `{ "editedText": "…" }` → **Response** `{ "id": "uuid", "editedAt": "…" }`.
`404` if the answer isn't owned by the caller.

---

## Answer object (canonical shape)

```
Answer {
  id: uuid
  status: "grounded" | "no_grounded_answer"
  claims: Claim[]            // empty when no_grounded_answer
  generatedText: string?     // rendered from claims; null when no_grounded_answer
  editedText: string?        // authoritative when present
  model: string, modelVersion: string   // pinned; logged for the eval (Constitution V)
  dataAsOf: timestamp
}
Claim { text: string, citations: Citation[] }   // citations.length >= 1 for a rendered claim
Citation { artifactId: uuid, chunkId: uuid?, title: string, url: string, type: string }
```

## Contract tests (to author in /speckit-tasks)

1. Grounded question → every returned citation ID ∈ retrieved ACL-checked set; each rendered claim
   has ≥1 citation.
2. Question with no supporting artifact → `no_grounded_answer`, no fabricated text.
3. Cross-tenant / no-ACL artifact → never cited; another user's conversation → `404`.
4. Unconfirmed/superseded decision → not surfaced as a decision.
5. Provider outage → `503` degraded message, never a guessed answer.
6. Edit an answer → subsequent reads return `editedText` as authoritative.
7. Every `/ask` and `/summary` writes exactly one `query_event` (retention metric integrity).
