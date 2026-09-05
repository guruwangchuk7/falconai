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

**Walk (iterative linked-list):**
1. From `id`, walk **backward** via `supersedesId` to the root, collecting ids.
2. Walk **forward** via reverse lookup (`where supersedesId = current.id`) to the tip.
3. Concatenate into the ordered chain root → tip.

**Invariants / guards:**
- **Cycle guard:** a `visited: Set<string>` — never revisit an id (defensive against a data cycle).
- **Cap:** `MAX_CHAIN = 50`; if exceeded, stop and `captureException`/log (no silent truncation).
- **Single successor:** post-PR-#35 a record has ≤1 successor. The forward lookup still uses
  `.limit(1)` ordered by `confirmedAt asc` as a deterministic belt for any legacy forked data —
  it never fabricates or hides a branch silently; it just picks the earliest deterministically.

**Traversing masked nodes (not a leak):** tenant RLS lets us read a row's *structural pointers*
(`id`, `supersedesId`) even when the row is `attendees_only`. We use those pointers to keep
walking, while the **content** projection is gated by the existing `canSee(visibility, participants)`
helper (reused verbatim from `getDecision`). Reading a pointer is not reading content.

**Projection per node:**

```ts
type TimelineNode =
  | { restricted: false;
      id: string; title: string; decision: string | null; rationale: string | null;
      date: string;                 // confirmedAt ?? createdAt (ISO)
      confirmedByName: string | null; // resolved display name, NOT a raw UUID
      origin: string;               // manual | suggested | meeting (badge)
      status: string;               // confirmed | superseded
      isCurrent: boolean;           // the tip (no successor)
      isViewed: boolean }           // the record whose detail page we're on
  | { restricted: true; isCurrent: boolean };  // masked hop: position only, zero content
```

- `confirmedByName` is resolved via a `users` join (batch, one query for all node owners) so the
  timeline never shows a raw UUID (the current detail page's raw-UUID display is a pre-existing
  wart we avoid repeating here; we do not change that existing row in this feature).
- `isCurrent` may be `true` on a **masked** node — an honest "the current version is one you can't
  see" state. The **viewed** record is always accessible (`getDecision` returns null otherwise), so
  `isViewed` never coincides with `restricted: true`.

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
  that end (the neighbor fetch returns nothing).
- **Dismissed nodes** (`dismissedAt` set): still shown in the lineage (dismissal is orthogonal to
  supersession) with a subtle "dismissed" marker.
- **Only confirmed/superseded records appear:** an in-flight `unconfirmed` supersede isn't linked
  until it's confirmed, so it never shows mid-chain.
- **Cycle / over-cap:** guarded as above; logged, never infinite-loops or silently truncates.
- **Masked date via position:** a masked node's position between two dated neighbors implicitly
  bounds its date. This is inherent to showing position honestly and is accepted (per the scope
  decision) — we still emit no explicit date for it.

## Testing

Unit tests (stubbed `tx`, mirroring `decision-status` / `answer-grounding` patterns) on the pure
assembly + masking:
- multi-hop chain assembled in correct root→tip order from a **middle** entry point (both walks);
- a masked **middle** hop → `{restricted:true}` placeholder at the right position, no content;
- a masked **tip** → `isCurrent: true` on a restricted node;
- **single-node** chain → returns length 1 (page renders no timeline);
- **cycle** guard terminates; **over-cap** stops + logs;
- `confirmedByName` resolves to a name, never a UUID.

(The supersede-fork fix and its regression live in PR #35 — integration, real Postgres.)

## Demo data (for the showcase video)

Nothing in the workspace is superseded yet, so the timeline would render nothing to film. Seed one
real lineage via the existing confirmed-record + `supersedeDecision` path, e.g.
*"Datastore: SQLite"* → *"Datastore: Postgres"* → *"Datastore: Neon"*, all confirmed and chained.
This is data creation only (US3 is already built), not part of the feature code.

## Build size

Core function + one server component + wiring + unit tests + demo seed. Roughly C1 / commitment-
sized. No migration, no new dependency.
