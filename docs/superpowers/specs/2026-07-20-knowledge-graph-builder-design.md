# Knowledge Graph Builder — Design

**Status:** Approved
**Date:** 2026-07-20

## Context

Sub-project 1 (meeting ingestion & transcription, via Zoom RTMS or LiveKit) is
fully built and verified live: it publishes every transcript event (interim +
final) plus meeting-lifecycle events to a Redis Stream
(`meeting:{meetingId}:transcript`), documented in
`docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`
as this subsystem's public contract. That document's "Long-term Falcon
architecture" section sketches four separate future stages after the stream —
Knowledge Graph Builder, Decision Extractor, Entity Resolver, Knowledge Graph
— as context, not a design.

This document scopes the next sub-project: **turning a completed meeting's
transcript into a queryable graph of decisions, people, and topics.** Rather
than building those four stages as four separate sub-projects, this design
treats them as internal stages of one system — the first version of the
Knowledge Graph itself, with a built-in extraction pipeline, rather than an
extraction stage with no graph to write into yet.

## Goals

- Automatically process every meeting's transcript once it ends, with no
  manual step.
- Extract concrete decisions made during the meeting, the people who made
  them, and the topics/entities they reference.
- Persist this as an actual queryable graph (nodes and edges), not just
  structured JSON per meeting.
- Accumulate a person's history across meetings (the same person recognized
  across multiple meetings), not just per-meeting islands.
- Prove the pipeline works against a real meeting's transcript, verified by
  direct SQL query against the resulting graph.

## Non-goals (out of scope for this sub-project)

- Live/incremental processing during a meeting — this is a strictly
  post-meeting batch job triggered by `meeting_lifecycle: ended`/`ended_error`.
- Action items / follow-up tasks as a distinct entity type (only Decisions,
  People, and a generic Topic/Entity node are modeled in v1).
- Fuzzy or ML-based entity resolution across meetings — v1 uses exact,
  case-insensitive name matching only. A more sophisticated Entity Resolver
  remains future work if simple matching proves insufficient.
- Integration with external systems (GitHub, Jira, Linear) to resolve
  mentioned tickets/PRs to real records — topics are captured as plain labels
  only.
- Any query API, dashboard, or UI over the graph — this sub-project's output
  is queried directly via SQL, the same way sub-project 1's output was
  verified via direct Postgres/Redis queries before any consumer existed.
- The Dynamic Agent Manager, Main Falcon Coordinator, or anything downstream
  of the graph — those remain separately-scoped future sub-projects per
  `ROADMAP.md`.

## Approaches considered

**A. Separate sub-projects per architecture-diagram stage.** Build "Knowledge
Graph Builder" as literally just the first stage (stream → structured
decision/entity candidates), with Entity Resolver and the graph store itself
as later, separately-brainstormed sub-projects. Most faithful to the original
diagram, but produces no queryable milestone at the end of this sub-project —
just JSON with nowhere to live yet.

**B. Whole pipeline as one sub-project (chosen).** Treat "Knowledge Graph
Builder," "Decision Extractor," "Entity Resolver," and "Knowledge Graph" from
the original diagram as internal stages of one system: consume the stream,
extract, resolve identity, write to a real graph store. Produces an actual
queryable graph as this sub-project's deliverable — a genuine milestone, and
consistent with how `ROADMAP.md` already frames the next step ("turns raw
transcript events into structured decisions/entities"). The four-stage names
were illustrative of *responsibilities*, not a mandate for four separate
sub-projects.

**C. Live/incremental extraction.** Process transcript events as they arrive
during the meeting rather than waiting for it to end. Rejected: extraction
quality benefits from seeing the complete meeting (a decision made mid-meeting
may only make sense once the discussion resolves), and there is no current
consumer that needs mid-meeting graph updates. Revisit only if a future
sub-project (e.g. an in-meeting agent) needs it.

## Architecture

```
Postgres `meetings` table (existing, unmodified — status set to
'ended'/'ended_error' by PostgresTranscriptStore.closeMeeting, the same
codepath that publishes the lifecycle event to Redis in sub-project 1)
        │  (KnowledgeGraphWorker polls this on an interval)
        ▼
KnowledgeGraphWorker  ── finds meetings.status IN ('ended','ended_error')
        │                lacking a completed graph_builds row
        ▼
TranscriptFetcher  ── reads final transcript_events for meetingId from Postgres, ordered by sequenceNumber
        │
        ▼
DecisionExtractor  ── one Claude API call per meeting, forced structured JSON output
        │
        ▼
GraphWriter  ── upserts nodes/edges into Postgres in one transaction per meeting
        │
        ▼
graph_nodes / graph_edges tables  ◄── queryable via SQL (this sub-project's "public
                                       contract" — future consumers like the Dynamic
                                       Agent Manager query these tables directly;
                                       no query API is built in this sub-project)
```

This sub-project does not consume the Redis Stream at all. An earlier version
of this design proposed a Redis Streams consumer group on
`meeting:{meetingId}:transcript` for the trigger, but that has no clean
solution: each meeting gets its own stream key, and Redis Streams have no
wildcard/pattern subscription — a consumer group must be created against a
specific key you already know about, so a generic worker has no way to
"subscribe to all future meetings' streams" without first learning each
meeting's ID from somewhere else. The `meetings` table already durably
records the same lifecycle transition (`status` becomes `'ended'` or
`'ended_error'`, set by the exact same `PostgresTranscriptStore.closeMeeting`
call that publishes the Redis lifecycle event), so polling it directly is
both simpler and avoids the discovery problem entirely.

New composition root, sibling to `src/server/index.ts` / `livekitIndex.ts`:
`src/server/knowledgeGraphIndex.ts`, a standalone long-running worker process
— not part of the Zoom/LiveKit HTTP servers, since it only needs Postgres and
the Claude API, never a meeting-source SDK or Redis.

### Components

**`KnowledgeGraphWorker`** — runs a single continuous loop: on each tick,
query `meetings` for rows with `status IN ('ended', 'ended_error')` that have
no `graph_builds` row, or whose `graph_builds.status = 'processing'` (a
crash-recovery case — see Error handling); `completed` and `failed` rows are
excluded. For each match, found sequentially within the same tick (never
concurrently), writes/updates its `graph_builds` row to `processing`, drives
the build through `TranscriptFetcher` → `DecisionExtractor` → `GraphWriter`,
and updates `graph_builds` to `completed`/`failed` — then sleeps a fixed
interval (e.g. 5–10 seconds) before the next tick. Because every tick
re-queries the same durable `meetings`/`graph_builds` state (not an ephemeral
stream position), there is nothing separate to "reconcile" on startup — the
very first tick after a restart naturally picks up anything left
unprocessed, including a meeting whose build was interrupted mid-way (still
`processing`, never `completed`).

**`TranscriptFetcher`** — reads all `isFinal: true` rows for a `meetingId`
from `transcript_events` (Postgres), ordered by `sequenceNumber`, and
formats them into plain text with speaker labels and timestamps
(`[startTs] speakerName: text`) for the extraction prompt.

**`DecisionExtractor`** — sends the formatted transcript to Claude
(`claude-opus-4-8`, via `@anthropic-ai/sdk`) using `output_config.format`
(structured outputs) with a forced JSON schema, requesting an array of
decisions (text, the speaker who made it, confidence, referenced topic
labels) and an array of standalone topic mentions. One call per meeting —
not latency- or cost-sensitive, so reliability of getting valid structured
output takes priority over speed.

**`GraphWriter`** — takes the extraction result plus the meeting's
participant roster and, within one Postgres transaction:
upserts a `Meeting` node (natural key: `meetingId`), upserts `Person` nodes
(natural key: trimmed, lowercased display name — same identity across
meetings), inserts a fresh `Decision` node per extracted decision (no natural
key; always a new row), upserts `Topic` nodes (natural key: normalized
label), and inserts the `PARTICIPATED_IN`/`MADE`/`MENTIONS`/`MADE_IN` edges
connecting them. Commits atomically — a partial extraction never leaves a
half-written graph.

**`graph_builds`** table — tracks per-meeting build status
(`processing`/`completed`/`failed`), the sole idempotency boundary:
a meeting already `processing` or `completed` is excluded from the next poll
tick's candidate set, so repeated ticks (including the first tick after any
restart) never trigger a duplicate build.

## Schema

```sql
-- graph_nodes: one row per entity
id            uuid primary key
type          text not null  -- 'meeting' | 'person' | 'decision' | 'topic'
natural_key   text           -- normalized dedup key: meetingId (meeting), lowercased
              null              trimmed name (person), normalized label (topic);
                                null for decision (no natural key — always a new row)
label         text not null  -- display text
attributes    jsonb not null default '{}'
              -- meeting: {startedAtMs, endedAtMs}
              -- decision: {text, confidence, startTs, endTs}
              -- person: {}
              -- topic: {}
created_at    timestamptz not null default now()

unique (type, natural_key) where natural_key is not null

-- graph_edges: directed relationship between two nodes
id            uuid primary key
from_node_id  uuid not null references graph_nodes(id)
to_node_id    uuid not null references graph_nodes(id)
type          text not null  -- 'PARTICIPATED_IN' | 'MADE' | 'MENTIONS' | 'MADE_IN'
created_at    timestamptz not null default now()

-- graph_builds: per-meeting idempotency + reconciliation tracking
meeting_id    text primary key
status        text not null  -- 'processing' | 'completed' | 'failed'
error         text
started_at    timestamptz
completed_at  timestamptz
```

Edges: `Person -[PARTICIPATED_IN]-> Meeting`, `Person -[MADE]-> Decision`,
`Decision -[MENTIONS]-> Topic`, `Decision -[MADE_IN]-> Meeting` (so a decision
traces back to its meeting without joining through a participant).

## Data flow

1. On each poll tick, `KnowledgeGraphWorker` queries for meetings needing a
   build: `meetings.status IN ('ended', 'ended_error')` AND (no
   `graph_builds` row exists for that `meetingId`, OR its `graph_builds.status
   = 'processing'`) — i.e. every ended meeting except ones already
   `completed` or `failed`. Including `processing` rows in the candidate set
   is what makes a crash mid-build recoverable: that meeting's row is stuck
   at `processing` forever otherwise.
2. For each matching meeting (processed one at a time, fully awaited before
   moving to the next — see Error handling for why this ordering matters),
   upserts its `graph_builds` row to `processing`.
3. `TranscriptFetcher` pulls all final `transcript_events` for the meeting
   from Postgres, ordered by `sequenceNumber`, formatted for the prompt. The
   participant roster is derived from the distinct `(participantId,
   speakerName)` pairs across those rows, not from the
   `meeting_lifecycle: started` event — per `CLAUDE.md`, LiveKit meetings'
   `started` event always carries an empty participant list (a known v1 gap
   in sub-project 1), so the transcript itself is the only reliable source
   of who actually participated.
4. `DecisionExtractor` sends the formatted transcript to Claude with a
   forced JSON schema requesting decisions and topic mentions.
5. `GraphWriter` opens one Postgres transaction: upsert `Meeting`, upsert
   `Person` nodes from the participant roster, insert `Decision` nodes,
   upsert `Topic` nodes, insert all edges. Commit.
6. `graph_builds` row set to `completed` (or `failed` with the error
   message — see Error handling).
7. There is no separate startup reconciliation step: because the trigger
   itself is a poll against durable Postgres state rather than a stream
   position, the worker's very first poll tick after any restart re-derives
   the correct set of meetings needing a build — including one left
   `processing` by a crash mid-build (step 1's candidate query picks it up
   directly).

## Error handling

- **Poll-based trigger, no separate delivery mechanism to fail**: since the
  trigger is a plain Postgres query re-run on every tick, there is no
  message queue, consumer group, or acknowledgment to reason about — a
  worker crash at any point just means the next tick (on this instance or a
  restarted one) re-queries the same durable state and picks up where things
  left off.
- **Single sequential poll loop, no in-process concurrency**: the worker is
  one continuously-running loop — `await` a full poll tick (every candidate
  meeting fully processed) before sleeping and polling again — rather than a
  raw fixed-rate timer that could fire again while a previous tick is still
  running. This is what makes including `processing` rows in the candidate
  set (step 1) safe: a meeting genuinely still being built by *this same*
  process is never revisited mid-build, since the next tick doesn't start
  until the current one finishes. Only a restart (a fresh process with no
  memory of what it was doing) can leave a row at `processing` for the next
  tick to legitimately retry.
- **Claude API failures** (rate limit, 5xx, malformed or refused structured
  output): rely on the SDK's default retry-with-backoff for transient
  failures; on exhausted retries, mark `graph_builds.status = 'failed'` with
  the error message and move on to the next meeting. A failed build never
  blocks the worker from processing other meetings, and is not
  automatically retried on subsequent ticks (a `failed` row is excluded from
  the candidate query, same as `completed`) — left for manual reprocessing.
- **Postgres write failures** (writing the graph): retry with backoff, then
  `failed` — same as above. Unlike sub-project 1's pipeline, there is no
  live delivery to prioritize here, so there is no asymmetric
  retry-and-continue; a failed graph build is simply marked failed and left
  for manual reprocessing (query `graph_builds where status = 'failed'`).

## Testing

- **Unit**: `GraphWriter` node/edge upsert logic (dedup by `natural_key`,
  transaction rollback on partial failure) against a fake Postgres client;
  `TranscriptFetcher` formatting; `DecisionExtractor`'s prompt construction
  and response-schema validation against a fake Claude client.
- **Integration**: a synthetic meeting's `transcript_events` rows fed through
  the real pipeline (real Postgres, fake Claude response) verifying the
  resulting `graph_nodes`/`graph_edges` rows are correct, and that running
  the same meeting twice doesn't duplicate anything.
- **Manual/live**: a real LiveKit meeting with actual conversation containing
  a clear decision or two, processed automatically end-to-end by the running
  worker (no manual trigger step), verified via direct SQL queries against
  `graph_nodes`/`graph_edges` — mirroring how sub-project 1 was verified via
  direct Postgres/Redis queries before any consumer existed.

## Long-term Falcon architecture (context, not designed here)

Unchanged from `docs/superpowers/specs/2026-07-15-meeting-ingestion-transcription-pipeline-design.md`:
this sub-project's `graph_nodes`/`graph_edges` tables become the foundation
the Dynamic Agent Manager and Main Falcon Coordinator will eventually read
from. Neither is designed or scoped by this document.
