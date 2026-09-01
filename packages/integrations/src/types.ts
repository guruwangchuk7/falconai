export type Provider = 'github' | 'linear' | 'jira';
export type TrustTier = 'trusted' | 'mixed' | 'untrusted';

/** The common, provider-neutral shape adapters map every artifact to. The worker adds
 *  workspace_id and resolves userExternalId → the app user before persisting. */
export interface ArtifactInput {
  source: Provider;
  externalRef: string;            // "#482", "ENG-217"
  type: string;                   // pr | commit | review_comment | issue | estimate | comment
  title: string | null;
  body: string | null;
  repoOrProject: string | null;
  aclTags: string[];              // repos/projects gating retrieval (per-repo ACL)
  trustTier: TrustTier;           // set at ingestion (F7.2, D9)
  sourceUpdatedAt: string | null; // ISO
  ownerExternalId: string | null; // provider-side author id/login → mapped to a user
  state?: string | null;          // pr: merged|closed|open ; issue: completed|canceled|started|...
  mergedClosedAt?: string | null; // ISO of the merge/close/complete event; the mine-watermark comparand
}

export interface Cursor {
  since?: string; // ISO; poll/backfill boundary
}

export interface SourceAdapter {
  readonly provider: Provider;
  /** Rate-limited, cursored fetch of artifacts changed within the window. */
  listChanged(cursor: Cursor): AsyncIterable<ArtifactInput>;
  /** Parse a verified webhook payload into a delta (signature verification is the caller's job). */
  parseWebhook(payload: unknown): ArtifactInput[] | null;
}

/** Maps a GitHub-shaped PR's merged/closed timestamps to our provider-neutral state + watermark. */
export function mapPullState(pr: { merged_at?: string | null; closed_at?: string | null }): { state: string; mergedClosedAt: string | null } {
  if (pr.merged_at) return { state: 'merged', mergedClosedAt: pr.merged_at };
  if (pr.closed_at) return { state: 'closed', mergedClosedAt: pr.closed_at };
  return { state: 'open', mergedClosedAt: null };
}

/** trust tier heuristic (D9): a workspace member's own authored artifact is trusted; free-text
 *  comment bodies from anywhere are untrusted; commit content is in-between. */
export function trustFor(type: string, authoredByMember: boolean): TrustTier {
  if (type === 'comment' || type === 'review_comment') return 'untrusted';
  if (type === 'commit') return 'mixed';
  return authoredByMember ? 'trusted' : 'untrusted';
}
