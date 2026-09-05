# Decision Timeline — design (2026-09-05)

Showcase feature #2 (memory-layer track). Turns a single Decision Record's supersession
lineage into an ordered, ACL-safe timeline shown inline on the decision detail page —
answering "how did we decide this, and how did the decision change over time?"

Traces to: F10.1 (Decision Record lifecycle), R23 (only confirmed records retrievable /
supersession), D15 (chain-neighbor ACL masking). Depends on the fork fix in
`fix/supersede-atomic-no-branch` (PR #35) — the chain is now guaranteed single-successor.

## Problem

A decision evolves: *"Use SQLite"* → superseded by *"Use Postgres"* → superseded by
*"Use Neon"*. Today the model stores this as a `supersedesId` linked list, and `getDecision`
surfaces only **±1 hop** ("Supersedes" / "Superseded by") on the detail page, each hop
ACL-masked. Users (founder / CTO / marketer) want the **whole** lineage in one view, not one
hop at a time.

## Scope (decided)

- **Full per-decision lineage** — walk the entire chain, both directions from the record being
  viewed, and render it as an ordered timeline (oldest → current).
- **Inline on `/decisions/[id]`** — replace the two ±1 rows with the timeline. **Renders only
  when the chain has > 1 node**; a lone decision looks exactly as it does today (zero regression).
- **Honest masked hops** — a version the viewer can't see (`attendees_only` + not a participant)
  appears as a placeholder that occupies its position but leaks **no** content (no title, why, or
  date). Chain length stays honest; content stays sealed.

### Out of scope (YAGNI)

No new table / migration. No workspace-wide decision feed. No change to the Ask/answer path.
No supersede-*reason* capture (we don't store one; each new version's "why" is its own rationale).
No dedicated route — inline only.

## Architecture

### Core — `getDecisionTimeline(deps, workspaceId, id, viewerUserId?) → TimelineNode[]`

New function in `packages/core/src/decisions.ts` (alongside `getDecision`). Runs in one
`withTenant` transaction.

The masking is enforced at the **query layer**, not in application code. Masked content must never
cross the database boundary — matching the house style (the answer path gates artifacts with an ACL
`WHERE` clause, `retrieve.ts`; `listQueue` omits masked rows in SQL). A single function that fetches
every row and then discards the unreadable ones in TypeScript is the flag pattern in disguise: the
masked content sits in process memory, one `console.log` / error serializer / careless refactor away
from a response body, and no test would catch it. So the walk is **two passes**:

**Pass 1 — Structural (no content).** A single recursive CTE (`WITH RECURSIVE`) collects the whole
connected chain from `id` — following `supersedesId` upward and the reverse edge downward — selecting
**only** `id, supersedes_id, visibility, participants, confirmed_at, dismissed_at, origin, status`.
No `title`, no `decision`, no `rationale`. This set is safe to read at any visibility ("reading a
pointer isn't reading content" — true precisely because content is not in the select list). The CTE
carries a depth guard (cap `MAX_CHAIN = 50`) and terminates on cycles via `UNION` (deduped working
set); one round trip replaces the N+1 walk. Post-PR-#35 each record has ≤1 successor, so the set
linearizes to one chain; ordering is done in memory from the `id → supersedes_id` map (find the root —
the node whose `supersedes_id` is null or outside the set — then walk down). If a fork is somehow
present in legacy data, ordering is deterministic (earliest `confirmed_at`) and logged, never silently
truncated.

**Pass 2 — Content (visible ids only).** Compute the visible id set by applying the existing
`canSee(visibility, participants)` rule (reused from `getDecision`) to the structural rows. Then a
second query fetches `title, decision, rationale, origin` **`WHERE id IN (<visible ids>)`** joined to
`users` for the confirmer's display name. A masked node's title/rationale is never in any result set.

**Assembly.** Zip the ordered structural list with the content map: a node with a content row →
`restricted:false` with its fields; a node absent from the content map (masked) → `restricted:true`
placeholder at its position.

**Projection per node:**

```ts
type TimelineNode =
  | { restricted: false;
      id: string; title: string; decision: string | null; rationale: string | null;
      date: string;                 // confirmedAt (ISO). Chain nodes are always confirmed, so this
                                    // is always set; a null is a data anomaly — omit + log, never
                                    // fall back to createdAt (a plausible-looking wrong date).
      confirmedByName: string | null; // resolved display name, NOT a raw UUID
      origin: string;               // manual | suggested | meeting (badge)
      status: string;               // confirmed | superseded
      isCurrent: boolean;           // the tip (no successor)
      isViewed: boolean }           // the record whose detail page we're on
  | { restricted: true; isCurrent: boolean };  // masked hop: position only, zero content
```

- `isCurrent` may be `true` on a **masked** node — an honest "the current version is one you can't
  see" state (the D15 tradeoff: status honest, content sealed). The **viewed** record is always
  accessible (`getDecision` returns null otherwise), so `isViewed` never coincides with `restricted`.

### Web — `DecisionTimeline` server component

`apps/web/app/(dashboard)/decisions/[id]/DecisionTimeline.tsx`. Vertical stepper, Quiet-Voltage
styled, oldest at top → **current** emphasized at the bottom. Each accessible node: title (links to
`/decisions/{id}`, except the viewed node), decision text, "why", date, `confirmedByName`, an origin
badge, and a "superseded" / "current" marker. Masked nodes: a muted "A version you don't have access
to" step. The viewed node is visually marked ("you are here").

`/decisions/[id]/page.tsx` calls `getDecisionTimeline`; when it returns > 1 node it renders
`<DecisionTimeline>` **in place of** the existing "Supersedes"/"Superseded by" rows (no duplication).
When ≤ 1 node, nothing changes from today.

## Data flow

`page.tsx` → `getDecisionTimeline(deps, workspaceId, id, viewerUserId)` → ordered `TimelineNode[]`
→ `<DecisionTimeline nodes=… />`. No writes, no queue, no new endpoint.

## Error handling / edge cases

- **Broken pointer** (a `supersedesId` referencing a deleted row): the walk terminates cleanly at
  that end (the neighbor is simply absent from the structural set).
- **Dismissed records never appear — it's an unreachable state, not a rendered one.** Supersession
  only links *confirmed* records; `dismissDecision` only tombstones `unconfirmed` ones (verified:
  its `WHERE status='unconfirmed'`). So a chain node can't be dismissed. We spec **no** UI for it:
  the code doesn't crash on a `dismissedAt`, but there is no "dismissed" marker for a state that
  can't occur.
- **Only confirmed/superseded records appear:** an in-flight `unconfirmed` supersede isn't linked
  until it's confirmed, so it never shows mid-chain. `confirmedAt` is therefore always set on a chain
  node; a null is treated as a data anomaly (omit the date + log), never masked with a fallback.
- **Cycle / over-cap:** the recursive CTE dedups via `UNION` and caps at `MAX_CHAIN`; logged, never
  infinite-loops or silently truncates.
- **Masked date via position:** a masked node's position between two dated neighbors implicitly
  bounds its date. This is inherent to showing position honestly and is accepted (per the scope
  decision) — we still emit no explicit date for it.

## Testing

**Integration (real Postgres — the security-critical proof), in `decision-tier-read.test.ts`:**
- A non-attendee calls `getDecisionTimeline` on a chain that contains an `attendees_only` node. The
  masked node's **title and rationale strings appear nowhere** in the returned structure, and it is
  present as a `restricted:true` placeholder at the correct position. This is the test a security
  reviewer asks for: it proves the *query* never fetched the content (not merely that assembly logic
  discarded it) and that RLS permits the structural read on an `attendees_only` row — a live
  assumption a stubbed `tx` cannot verify.
- The attendee (participant) sees the same node's full content — the masking is viewer-dependent, not
  a blanket hide.
- Ordering: a three-node chain returns oldest→current with the correct `isCurrent`/`isViewed` flags.

**Unit (stubbed `tx`, mirroring `decision-status` / `answer-grounding`) on the pure ordering/assembly:**
- ordered root→tip from a **middle** entry point; single-node → length 1 (page renders no timeline);
- cycle-set linearizes without looping; over-cap stops + logs;
- `confirmedByName` maps to a name, never a UUID.

Stubbed tests own the *ordering* logic; the integration test owns the *no-content-leak* invariant —
the split is deliberate (a double can't prove the SQL didn't select the masked column).

(The supersede-fork fix and its regression live in PR #35 — integration, real Postgres.)

## Demo data (for the showcase video)

Nothing in the workspace is superseded yet, so the timeline would render nothing to film. Seed one
real lineage via the existing confirmed-record + `supersedeDecision` path, e.g.
*"Datastore: SQLite"* → *"Datastore: Postgres"* → *"Datastore: Neon"*, all confirmed and chained.
This is data creation only (US3 is already built), not part of the feature code.

## Build size

Core function + one server component + wiring + unit tests + demo seed. Roughly C1 / commitment-
sized. No migration, no new dependency.
