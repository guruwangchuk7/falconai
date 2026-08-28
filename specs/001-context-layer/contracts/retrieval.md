# Contract: Internal Retrieval Interface

**Feature**: `specs/001-context-layer` — the load-bearing contract. Consumed in Phase 1 by the
`packages/evals` recall@k harness and the dashboard Decision Index search; in later phases by
participant agents. Enforces Constitution II (grounded or silent) and FR-007/012/017.

## `retrieve(input) → Result`  (in `packages/core`)

```ts
interface RetrieveInput {
  workspaceId: string;        // tenant; sets app.workspace_id (RLS + partition prune)
  requesterUserId: string;    // ACL is evaluated as THIS user
  query: string;              // natural-language topic
  k?: number;                 // default 8
  sources?: ('github'|'linear'|'jira'|'decision')[];  // optional filter
  freshnessHorizonDays?: number;  // overrides workspace default for flag computation
}

interface RetrievedItem {
  artifactId: string;
  type: string;               // pr|commit|issue|decision|...
  externalRef: string;        // "#482", "ENG-217" — provenance the caller can cite
  title: string;
  snippet: string;
  score: number;
  trustTier: 'trusted'|'mixed'|'untrusted';
  lastSyncedAt: string;
  isStale: boolean;           // true if past freshness horizon or sync failed
}

interface RetrieveResult {
  items: RetrievedItem[];
  degraded?: { reason: 'sync_stale'|'source_disconnected'; sources: string[] };
}
```

## Guarantees (tested)

1. **Tenant isolation** — every query runs inside a `set local app.workspace_id` transaction; no
   item from another workspace can appear (SC-003). RLS is the floor; partition pruning is the
   perf path. NEVER accept a `workspaceId` from untrusted input without a membership check.
2. **ACL** — an item is returned only if `requesterUserId` has access to its `acl_tags`
   (repo/project membership). Private-repo artifacts never returned to a non-member (SC-003).
3. **Provenance / grounded** — every `RetrievedItem` resolves to a real, stored artifact row;
   the interface cannot fabricate an item or return content the requester can't access (SC-004,
   Constitution II).
4. **Decision records** — only `status='confirmed'` are eligible; recency-weighted; `isStale`
   set past the freshness horizon (FR-012).
5. **Embedding space** — ANN filters `embedding_model = <current>`; never mixes vector spaces (A4).
6. **Untrusted content** — `trustTier` is returned so downstream keeps untrusted text out of
   instruction position (FR-008); retrieval itself does not execute artifact content.
7. **Honest degradation** — if a relevant source is stale/disconnected, `degraded` is populated
   rather than silently returning a thinner result set (FR-013).

## Non-goals (Phase 1)

No ranking-model tuning beyond `voyage-code-4` + optional `rerank-2.5` (gated by the eval); no
cross-workspace or org-wide search; no write path.
