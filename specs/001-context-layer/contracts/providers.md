# Contract: Provider Interfaces (`packages/llm`, `packages/secrets`, `packages/integrations`)

**Feature**: `specs/001-context-layer`. Thin interfaces so vendors are swappable by config +
canary, not a rewrite (Constitution V, review OV-11, PRD §12.8).

## LLM / embeddings / rerank  (`packages/llm`)

```ts
interface ChatProvider {          // digest generation (Phase 1)
  readonly model: string;         // PINNED, e.g. "claude-haiku-<pinned>" — never "-latest"
  complete(input: { system: string; messages: Msg[]; maxTokens: number }): Promise<{ text: string; usage: Usage }>;
}
interface EmbeddingProvider {
  readonly model: string;         // "voyage-code-4"
  readonly version: string;       // stored per row
  readonly dim: 1024;
  embed(texts: string[]): Promise<number[][]>;
}
interface RerankProvider {        // optional, gated by the eval
  readonly model: string;         // "rerank-2.5"
  rerank(query: string, docs: string[], topK: number): Promise<{ index: number; score: number }[]>;
}
```
- **Rules**: every `ChatProvider.complete` is logged to Langfuse with inputs (FR-015). Model +
  version are readable and recorded (drift monitor, R22). A second vendor implements the same
  interface for canary/failover (OV-11) — not wired in Phase 1, but the interface must not
  assume Anthropic.

## Secrets store  (`packages/secrets`)  — R26, blocker-class

```ts
interface SecretStore {
  put(ref: { workspaceId: string; provider: string; connectionId: string }, token: OAuthToken): Promise<string>; // returns secret_ref
  get(secretRef: string): Promise<OAuthToken>;   // worker-only
  rotate(secretRef: string, token: OAuthToken): Promise<void>;
  revoke(secretRef: string): Promise<void>;
}
```
- **Rules**: backed by the dedicated secrets store (Infisical / cloud Secrets Manager), NOT the
  app DB. Per-tenant envelope encryption. `get` is callable only from `apps/worker` (service
  credential). The app DB stores `secret_ref` only. A token value in any app-DB column is a
  build-blocking violation.

## Source adapters  (`packages/integrations`)

```ts
interface SourceAdapter {
  readonly provider: 'github'|'linear'|'jira';
  listChanged(since: Cursor, window: DateRange): AsyncIterable<RawArtifact>;  // rate-limited, cursored
  parseWebhook(payload: unknown): { workspaceId: string; delta: RawArtifact[] } | null;  // signature verified by caller
  toArtifact(raw: RawArtifact): Artifact;   // maps to the common shape + acl_tags + trust_tier
}
```
- **Rules**: exponential backoff + persisted cursor; never storm on recovery (§15.1). `toArtifact`
  sets `acl_tags` (repos/projects) and the ingestion `trust_tier` (FR-008). Adapters are pure
  mappers + fetchers; persistence/queueing is the job's concern.
