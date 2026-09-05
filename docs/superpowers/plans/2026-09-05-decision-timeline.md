# Decision Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Decision Record's full supersession lineage as an ordered, ACL-safe timeline inline on `/decisions/[id]`.

**Architecture:** A new `getDecisionTimeline` in `packages/core/src/decisions.ts` walks the chain in **two passes** — a structural recursive CTE that reads *only* pointers/metadata (no title/decision/rationale) for the whole chain in one query, then a content query that fetches prose `WHERE id IN (<ids the viewer may see>)`. Masked content therefore never crosses the DB boundary. A `DecisionTimeline` server component renders the result inline, replacing the current ±1 "Supersedes / Superseded by" rows, only when the chain has > 1 node.

**Tech Stack:** TypeScript, Drizzle ORM (postgres-js), Postgres (recursive CTE), Next.js App Router (server components), Tailwind (Quiet Voltage tokens), Vitest (unit + testcontainers integration).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-decision-timeline-design.md`.
- **Query-layer masking:** the content columns `title`, `decision`, `rationale` must NEVER be selected for a record the viewer cannot see. Enforce in SQL (`WHERE id IN (visible)`), not by fetch-then-discard.
- **Reuse the existing tier rule:** the masking predicate is the same `canSee(visibility, participants, viewerUserId)` logic already in `getDecision` — extract it to module scope, do not fork a second copy.
- **`decision_record` RLS is tenant-only** (workspace match); the attendee gate lives on `decision_span`. So the structural pass may read any in-tenant row's pointers; the tier gate is applied by the content-query id filter.
- **Date = `confirmedAt`** for a chain node (always set on confirmed/superseded rows). A null is a data anomaly → emit `null` + log, never fall back to `createdAt`.
- **No new table, no migration, no new route, no Ask-path change.**
- **Never commit to `main`.** Work on `feat/decision-timeline` (already rebased on `main`). Branch → PR → CI → human merge.
- Platform Windows/PowerShell; integration tests need Docker and run with `--pool-options.forks.singleFork`.
- Pin model versions never `-latest` (N/A here — no LLM calls in this feature).

---

### Task 1: Pure chain helpers + shared `canSee` (no DB)

Extract the tier predicate to module scope and add two pure functions that own all ordering/assembly logic, so it is unit-testable without a database.

**Files:**
- Modify: `packages/core/src/decisions.ts` (add exports near `getDecision`, ~line 318–416)
- Test: `tests/unit/decision-timeline.test.ts` (create)

**Interfaces:**
- Produces:
  - `canSeeVisibility(visibility: string | null, participants: unknown, viewerUserId?: string): boolean`
  - `interface StructuralNode { id: string; supersedesId: string | null; visibility: string | null; participants: unknown; confirmedAt: Date | null; origin: string; status: string }`
  - `type TimelineNode = { restricted: false; id: string; title: string; decision: string | null; rationale: string | null; date: string | null; confirmedByName: string | null; origin: string; status: string; isCurrent: boolean; isViewed: boolean } | { restricted: true; isCurrent: boolean }`
  - `interface TimelineContent { id: string; title: string; decision: string | null; rationale: string | null; origin: string; confirmedByName: string | null }`
  - `orderChain(rows: StructuralNode[]): { ordered: StructuralNode[]; forked: boolean }` — root→tip order.
  - `buildTimeline(ordered: StructuralNode[], content: Map<string, TimelineContent>, entryId: string, viewerUserId?: string): TimelineNode[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/decision-timeline.test.ts`:

```ts
import { it, expect } from 'vitest';
import { canSeeVisibility, orderChain, buildTimeline, type StructuralNode, type TimelineContent } from '@falcon/core';

const node = (id: string, supersedesId: string | null, over: Partial<StructuralNode> = {}): StructuralNode => ({
  id, supersedesId, visibility: 'workspace', participants: null,
  confirmedAt: new Date(`2026-0${id}-01T00:00:00Z`), origin: 'manual', status: supersedesId === null ? 'superseded' : 'superseded', ...over,
});

it('canSeeVisibility: workspace is visible to anyone; attendees_only only to a participant', () => {
  expect(canSeeVisibility('workspace', null, undefined)).toBe(true);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], 'u1')).toBe(true);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], 'u2')).toBe(false);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], undefined)).toBe(false);
});

it('orderChain: linearizes a 3-node chain root->tip regardless of input order', () => {
  const rows = [node('3', '2', { status: 'confirmed' }), node('1', null), node('2', '1')];
  const { ordered, forked } = orderChain(rows);
  expect(ordered.map((n) => n.id)).toEqual(['1', '2', '3']);
  expect(forked).toBe(false);
});

it('buildTimeline: marks the tip current, the entry viewed, and masks nodes absent from content', () => {
  const rows = [node('1', null), node('2', '1', { visibility: 'attendees_only', participants: [{ userId: 'x' }] }), node('3', '2', { status: 'confirmed' })];
  const { ordered } = orderChain(rows);
  const content = new Map<string, TimelineContent>([
    ['1', { id: '1', title: 'SQLite', decision: 'use sqlite', rationale: 'simple', origin: 'manual', confirmedByName: 'Guru' }],
    ['3', { id: '3', title: 'Neon', decision: 'use neon', rationale: 'scale', origin: 'manual', confirmedByName: 'Dana' }],
  ]); // node 2 intentionally absent -> masked
  const tl = buildTimeline(ordered, content, '3', 'outsider');
  expect(tl).toHaveLength(3);
  expect(tl[0]).toMatchObject({ restricted: false, id: '1', isCurrent: false, isViewed: false });
  expect(tl[1]).toEqual({ restricted: true, isCurrent: false });
  expect(tl[2]).toMatchObject({ restricted: false, id: '3', isCurrent: true, isViewed: true });
});

it('buildTimeline: a masked TIP surfaces as restricted + isCurrent (current version you cannot see)', () => {
  const rows = [node('1', null), node('2', '1', { visibility: 'attendees_only', participants: [{ userId: 'x' }], status: 'confirmed' })];
  const { ordered } = orderChain(rows);
  const content = new Map<string, TimelineContent>([['1', { id: '1', title: 'A', decision: 'a', rationale: null, origin: 'manual', confirmedByName: null }]]);
  const tl = buildTimeline(ordered, content, '1', 'outsider');
  expect(tl[1]).toEqual({ restricted: true, isCurrent: true });
});

it('orderChain: a fork (two successors of one node) is deterministic by confirmedAt and flags forked', () => {
  const rows = [node('1', null), node('2', '1', { confirmedAt: new Date('2026-02-01') }), node('3', '1', { confirmedAt: new Date('2026-03-01') })];
  const { ordered, forked } = orderChain(rows);
  expect(forked).toBe(true);
  expect(ordered[0]!.id).toBe('1');
  expect(ordered[1]!.id).toBe('2'); // earliest successor wins deterministically
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/decision-timeline.test.ts`
Expected: FAIL — `canSeeVisibility`/`orderChain`/`buildTimeline` not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/core/src/decisions.ts`, add near the `getDecision` block:

```ts
/** The D13/D15 tier predicate: an `attendees_only` record's content is visible ONLY to a viewer in
 *  its participants snapshot; everything else is workspace-visible. Extracted so getDecision and the
 *  timeline share ONE rule (no forked copy). */
export function canSeeVisibility(visibility: string | null, participants: unknown, viewerUserId?: string): boolean {
  return visibility !== 'attendees_only' ||
    (!!viewerUserId && Array.isArray(participants) && (participants as { userId?: string }[]).some((p) => p?.userId === viewerUserId));
}

export interface StructuralNode {
  id: string; supersedesId: string | null; visibility: string | null; participants: unknown;
  confirmedAt: Date | null; origin: string; status: string;
}
export interface TimelineContent {
  id: string; title: string; decision: string | null; rationale: string | null; origin: string; confirmedByName: string | null;
}
export type TimelineNode =
  | { restricted: false; id: string; title: string; decision: string | null; rationale: string | null;
      date: string | null; confirmedByName: string | null; origin: string; status: string; isCurrent: boolean; isViewed: boolean }
  | { restricted: true; isCurrent: boolean };

/** Linearize the structural chain root -> tip. Root = the node whose supersedesId is null or points
 *  outside the set. Walks successors (the node whose supersedesId === current.id). Post-fork-fix there
 *  is ≤1 successor; if legacy data has a fork, pick the earliest-confirmed deterministically and flag it.
 *  A visited set guards against a data cycle. */
export function orderChain(rows: StructuralNode[]): { ordered: StructuralNode[]; forked: boolean } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = new Set(byId.keys());
  const root = rows.find((r) => !r.supersedesId || !ids.has(r.supersedesId));
  if (!root) return { ordered: rows.slice(), forked: false }; // pure cycle / no root — degrade, don't loop
  const successorsOf = (id: string) =>
    rows.filter((r) => r.supersedesId === id).sort((a, b) => (a.confirmedAt?.getTime() ?? 0) - (b.confirmedAt?.getTime() ?? 0));
  const ordered: StructuralNode[] = [];
  const visited = new Set<string>();
  let cur: StructuralNode | undefined = root;
  let forked = false;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    ordered.push(cur);
    const succ = successorsOf(cur.id);
    if (succ.length > 1) forked = true;
    cur = succ[0];
  }
  return { ordered, forked };
}

/** Zip the ordered structural nodes with the content the viewer may see: present in content -> full
 *  node; absent -> masked placeholder (position only). Tip = last ordered node. */
export function buildTimeline(ordered: StructuralNode[], content: Map<string, TimelineContent>, entryId: string, _viewerUserId?: string): TimelineNode[] {
  const tipId = ordered.length ? ordered[ordered.length - 1]!.id : null;
  return ordered.map((n) => {
    const isCurrent = n.id === tipId;
    const c = content.get(n.id);
    if (!c) return { restricted: true, isCurrent };
    return {
      restricted: false, id: n.id, title: c.title, decision: c.decision, rationale: c.rationale,
      date: n.confirmedAt ? n.confirmedAt.toISOString() : null, confirmedByName: c.confirmedByName,
      origin: c.origin, status: n.status, isCurrent, isViewed: n.id === entryId,
    };
  });
}
```

Then refactor `getDecision`'s local `canSee` to delegate (DRY): replace its inline `const canSee = (visibility, participants) => …` body with `const canSee = (visibility: string | null, participants: unknown) => canSeeVisibility(visibility, participants, viewerUserId);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/decision-timeline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @falcon/core typecheck`
Expected: clean.

```bash
git add packages/core/src/decisions.ts tests/unit/decision-timeline.test.ts
git commit -m "feat(core): pure chain helpers + shared canSeeVisibility for decision timeline"
```

---

### Task 2: `getDecisionTimeline` — two-pass DB orchestration

**Files:**
- Modify: `packages/core/src/decisions.ts` (add after the helpers from Task 1)
- Modify: `packages/core/src/index.ts` (already `export * from './decisions.js'` — verify the new symbols are exported; no change needed if the barrel re-exports the module)

**Interfaces:**
- Consumes: `canSeeVisibility`, `orderChain`, `buildTimeline`, `StructuralNode`, `TimelineContent`, `TimelineNode` (Task 1).
- Produces: `getDecisionTimeline(deps: CoreDeps, workspaceId: string, id: string, viewerUserId?: string): Promise<TimelineNode[]>` — ordered root→tip; `[]` when the id isn't found; length 1 when the record has no chain.

- [ ] **Step 1: Implement `getDecisionTimeline`**

Add to `packages/core/src/decisions.ts` (imports: ensure `sql`, `inArray`, `eq` from `drizzle-orm` are imported — `sql` and `eq` already are; add `inArray`):

```ts
const MAX_CHAIN = 50;

/**
 * Full supersession lineage for a decision, ordered oldest -> current, ACL-safe. TWO PASSES so masked
 * content never crosses the DB boundary:
 *   1. STRUCTURAL — a recursive CTE collects the whole connected chain (both directions) selecting only
 *      pointers/metadata: id, supersedes_id, visibility, participants, confirmed_at, origin, status.
 *      No title/decision/rationale. decision_record RLS is tenant-only, so reading these for an
 *      attendees_only row is legitimate (a pointer is not content).
 *   2. CONTENT — fetch title/decision/rationale + confirmer name ONLY for ids the viewer may see
 *      (canSeeVisibility). Absent ids render as masked placeholders.
 * Returns [] if the record is absent, length 1 (no timeline shown by the caller) if it has no chain.
 */
export async function getDecisionTimeline(
  deps: CoreDeps, workspaceId: string, id: string, viewerUserId?: string,
): Promise<TimelineNode[]> {
  return deps.db.withTenant(workspaceId, async (tx) => {
    // Pass 1: structural (no content columns).
    const res = await tx.execute(sql`
      with recursive chain as (
        select id, supersedes_id, visibility, participants, confirmed_at, origin, status, 1 as depth
        from decision_record where id = ${id}
        union
        select d.id, d.supersedes_id, d.visibility, d.participants, d.confirmed_at, d.origin, d.status, c.depth + 1
        from decision_record d
        join chain c on (d.id = c.supersedes_id or d.supersedes_id = c.id)
        where c.depth < ${MAX_CHAIN}
      )
      select distinct id, supersedes_id, visibility, participants, confirmed_at, origin, status from chain
    `);
    const rows = (res as unknown as Array<Record<string, unknown>>).map((r): StructuralNode => ({
      id: r.id as string,
      supersedesId: (r.supersedes_id as string | null) ?? null,
      visibility: (r.visibility as string | null) ?? null,
      participants: r.participants ?? null,
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at as string) : null,
      origin: (r.origin as string) ?? 'manual',
      status: (r.status as string) ?? 'confirmed',
    }));
    if (rows.length === 0) return [];

    const { ordered, forked } = orderChain(rows);
    if (forked) console.warn(`[decision-timeline] forked chain at decision ${id} (${workspaceId}) — ordering deterministically`);

    // Pass 2: content for visible ids only.
    const visibleIds = ordered.filter((n) => canSeeVisibility(n.visibility, n.participants, viewerUserId)).map((n) => n.id);
    const content = new Map<string, TimelineContent>();
    if (visibleIds.length > 0) {
      const crows = await tx
        .select({
          id: schema.decisionRecord.id, title: schema.decisionRecord.title, decision: schema.decisionRecord.decision,
          rationale: schema.decisionRecord.rationale, origin: schema.decisionRecord.origin, confirmedByName: schema.users.name,
        })
        .from(schema.decisionRecord)
        .leftJoin(schema.users, eq(schema.users.id, schema.decisionRecord.confirmedBy))
        .where(inArray(schema.decisionRecord.id, visibleIds));
      for (const c of crows) content.set(c.id, { id: c.id, title: c.title, decision: c.decision, rationale: c.rationale, origin: c.origin, confirmedByName: c.confirmedByName ?? null });
    }
    return buildTimeline(ordered, content, id, viewerUserId);
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @falcon/core typecheck`
Expected: clean. (If `tx.execute` typing complains, the `as unknown as Array<...>` cast handles the postgres-js RowList shape.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/decisions.ts
git commit -m "feat(core): getDecisionTimeline two-pass walk (structural CTE + visible-only content)"
```

---

### Task 3: Integration masking test (real Postgres)

Proves the no-leak invariant end-to-end: a non-attendee's timeline contains a masked node's strings nowhere, while an attendee sees them.

**Files:**
- Modify: `tests/integration/decision-tier-read.test.ts` (add import + `supersedeDecision`, add tests at the end)

**Interfaces:**
- Consumes: `getDecisionTimeline` (Task 2), `supersedeDecision` (existing), the file's `seedConfirmed` helper.

- [ ] **Step 1: Write the failing tests**

At the top import line, add `getDecisionTimeline` and `supersedeDecision`:

```ts
import { createDecision, confirmDecision, searchDecisions, getDecision, getDecisionSpans, getDecisionTimeline, supersedeDecision, type CoreDeps } from '@falcon/core';
```

Append:

```ts
// Build A (workspace) -> B (attendees_only) -> C (workspace), C current. Chain via supersede.
async function seedChain() {
  const a = await seedConfirmed('workspace', 'ChainSQLite');
  const b = await seedConfirmed('attendees_only', 'ChainSecretPivot');
  await supersedeDecision(deps, WS_A, { newRecordId: b, supersedesId: a });
  const c = await seedConfirmed('workspace', 'ChainNeon');
  await supersedeDecision(deps, WS_A, { newRecordId: c, supersedesId: b });
  return { a, b, c };
}

it('getDecisionTimeline: masked node leaks NO content to a non-attendee, but is present by position', async () => {
  const { a, b, c } = await seedChain();
  const tl = await getDecisionTimeline(deps, WS_A, c, OUTSIDER);
  expect(tl.map((n) => (n.restricted ? 'MASKED' : n.id))).toEqual([a, 'MASKED', c]); // B masked, in order

  const blob = JSON.stringify(tl);
  expect(blob).not.toContain('ChainSecretPivot');            // masked title never crosses the boundary
  expect(blob).not.toContain('ChainSecretPivot decided');    // masked decision/rationale either
  const tip = tl[2];
  expect(tip.restricted).toBe(false);
  if (!tip.restricted) expect(tip.isCurrent).toBe(true);
});

it('getDecisionTimeline: the attendee sees the middle node fully', async () => {
  const { b, c } = await seedChain();
  const tl = await getDecisionTimeline(deps, WS_A, c, ATTENDEE);
  const middle = tl.find((n) => !n.restricted && n.id === b);
  expect(middle).toBeTruthy();
  expect(JSON.stringify(tl)).toContain('ChainSecretPivot');
});

it('getDecisionTimeline: a single (unsuperseded) decision returns length 1', async () => {
  const id = await seedConfirmed('workspace', 'LonelyDecision');
  expect(await getDecisionTimeline(deps, WS_A, id, ATTENDEE)).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify (requires Docker)**

Run: `pnpm vitest run tests/integration/decision-tier-read.test.ts --pool-options.forks.singleFork`
Expected (Docker up): PASS. If Docker is down locally, this runs in CI — note that and proceed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/decision-tier-read.test.ts
git commit -m "test(integration): decision timeline masks content at the query layer (no leak)"
```

---

### Task 4: `DecisionTimeline` component + wire into the detail page

**Files:**
- Create: `apps/web/app/(dashboard)/decisions/[id]/DecisionTimeline.tsx`
- Modify: `apps/web/app/(dashboard)/decisions/[id]/page.tsx` (import + call `getDecisionTimeline`; replace the `Supersedes` / `Superseded by` `<Row>`s at ~lines 77–90 with the timeline)

**Interfaces:**
- Consumes: `getDecisionTimeline`, `TimelineNode` (Task 2).

- [ ] **Step 1: Create the component**

`apps/web/app/(dashboard)/decisions/[id]/DecisionTimeline.tsx`:

```tsx
import Link from 'next/link';
import type { TimelineNode } from '@falcon/core';

/** Vertical supersession timeline, oldest -> current. Renders masked hops as honest, contentless
 *  placeholders. Server component (no client state). */
export function DecisionTimeline({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-wide text-muted">How this decision evolved</div>
      <ol className="mt-3 border-l border-hairline">
        {nodes.map((n, i) => (
          <li key={n.restricted ? `m${i}` : n.id} className="relative pl-5 pb-5 last:pb-0">
            <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${n.restricted ? 'bg-hairline' : n.isCurrent ? 'bg-forest' : 'bg-muted-soft'}`} />
            {n.restricted ? (
              <div className="text-sm text-muted">A version you don’t have access to</div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {n.isViewed
                    ? <span className="text-sm font-medium text-ink">{n.title}</span>
                    : <Link href={`/decisions/${n.id}`} className="text-sm font-medium text-ink underline decoration-dotted">{n.title}</Link>}
                  {n.isCurrent && <span className="rounded-full bg-forest/10 px-2 py-0.5 text-[11px] font-medium text-forest">current</span>}
                  {!n.isCurrent && <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-muted">superseded</span>}
                  {n.isViewed && <span className="text-[11px] text-muted-soft">you are here</span>}
                </div>
                {n.decision && <div className="mt-0.5 text-sm text-body">{n.decision}</div>}
                {n.rationale && <div className="mt-0.5 text-[13px] text-muted">why: {n.rationale}</div>}
                <div className="mt-0.5 text-[12px] text-muted-soft">
                  {n.date ? new Date(n.date).toLocaleDateString() : 'date unknown'}
                  {n.confirmedByName ? ` · ${n.confirmedByName}` : ''}
                  {` · from ${n.origin === 'meeting' ? 'a meeting' : n.origin === 'suggested' ? 'a synced source' : 'a person'}`}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the detail page**

In `apps/web/app/(dashboard)/decisions/[id]/page.tsx`:
1. Add import: `import { getDecisionTimeline } from '@falcon/core';` (extend the existing `@falcon/core` import) and `import { DecisionTimeline } from './DecisionTimeline';`.
2. After the `getDecision` call, add: `const timeline = await getDecisionTimeline(deps(), session.workspaceId, id, session.userId);`
3. **Delete** the two `<Row>` blocks for `Supersedes` and `Superseded by` (the `{(d.supersedesId || d.supersedesRestricted) && (…)}` and `{(d.supersededById || d.supersededByRestricted) && (…)}` blocks, ~lines 77–90).
4. After the closing `</div>` of the `divide-y` details block, add:

```tsx
{timeline.length > 1 && <DecisionTimeline nodes={timeline} />}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @falcon/web typecheck`
Expected: clean.
Run: `cd apps/web && pnpm build` (from repo root: `pnpm --filter @falcon/web build`)
Expected: build succeeds; `/decisions/[id]` in the route manifest.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/decisions/[id]/DecisionTimeline.tsx" "apps/web/app/(dashboard)/decisions/[id]/page.tsx"
git commit -m "feat(web): inline decision timeline on the detail page (replaces the ±1 rows)"
```

---

### Task 5: Verify whole feature + open PR

**Files:** none (verification + PR).

- [ ] **Step 1: Full typecheck + unit suite**

Run: `pnpm -r typecheck`
Expected: clean (15 packages).
Run: `pnpm vitest run tests/unit`
Expected: all pass (includes the new `decision-timeline.test.ts`).

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/decision-timeline
"C:/Program Files/GitHub CLI/gh.exe" pr create --base main --head feat/decision-timeline \
  --title "feat(web): decision timeline — full supersession lineage, ACL-safe" \
  --body "Implements docs/superpowers/specs/2026-09-05-decision-timeline-design.md. Two-pass query-layer masking (structural CTE + visible-only content), inline on /decisions/[id], integration test proves no masked content crosses the DB boundary. Depends on #35 (non-branching chain)."
```

- [ ] **Step 3: Watch CI**

Run: `"C:/Program Files/GitHub CLI/gh.exe" pr checks <N> --watch`
Expected: build, typecheck, integration (runs the Task 3 masking test on real Postgres), e2e, no-token-in-db all green. Report status; human names the PR to merge.

---

### Task 6: Demo lineage seed (post-merge, for the video) — REQUIRES APPROVAL

The timeline only renders when a chain exists. Seed one real lineage in the dev workspace so it's filmable. This WRITES to the live dev DB → needs explicit user approval before running (same gate as the `0011` migration).

**Files:**
- Create (temporary, not shipped): `apps/worker/src/seed-decision-lineage.ts`

- [ ] **Step 1: Write the seed script**

```ts
// Temporary demo seed — NOT shipped. Creates SQLite -> Postgres -> Neon in the first workspace/member.
import { getDb, schema } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { createDecision, confirmDecision, supersedeDecision, type CoreDeps } from '@falcon/core';

const deps: CoreDeps = { db: getDb(), llm: createLlmProviders() };

async function main() {
  const m = (await deps.db.rootDb.select({ workspaceId: schema.membership.workspaceId, userId: schema.membership.userId }).from(schema.membership).limit(1))[0];
  if (!m) throw new Error('no membership');
  const { workspaceId: ws, userId: uid } = m;
  const mk = async (title: string, decision: string, rationale: string) => {
    const { id } = await createDecision(deps, ws, { title, decision, rationale });
    await confirmDecision(deps, ws, id, uid);
    return id;
  };
  const a = await mk('Datastore: SQLite', 'Use SQLite', 'simplest to start');
  const b = await mk('Datastore: Postgres', 'Use Postgres', 'SQLite chokes on write concurrency');
  await supersedeDecision(deps, ws, { newRecordId: b, supersedesId: a });
  const c = await mk('Datastore: Neon', 'Use Neon (serverless Postgres)', 'need serverless scaling + branching');
  await supersedeDecision(deps, ws, { newRecordId: c, supersedesId: b });
  console.log(`seeded lineage a=${a} b=${b} c=${c} — open /decisions/${c}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it (AFTER explicit approval)**

Run: `pnpm --filter @falcon/worker exec node --import tsx --env-file=D:/falconAi/apps/web/.env.local src/seed-decision-lineage.ts`
Expected: prints the three ids + the `/decisions/<c>` URL. Open it to confirm the timeline renders A→B→C.

- [ ] **Step 3: Delete the temporary script**

```bash
rm apps/worker/src/seed-decision-lineage.ts
```

(No commit — the script is throwaway; the seeded rows live in the dev DB for the video.)
