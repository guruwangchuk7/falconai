/** A tiny labeled set to smoke-test the harness. Replace/extend with a real workspace-derived set
 *  (queries a PM/eng would ask → the artifacts that should surface) before trusting the numbers. */

export interface EvalDoc {
  id: string;
  text: string;
}
export interface EvalQuery {
  query: string;
  relevantIds: string[];
}

export const DOCS: EvalDoc[] = [
  { id: 'pr-auth', text: 'PR #412: add JWT refresh-token rotation to the auth service; fixes silent logout on expiry' },
  { id: 'pr-ratelimit', text: 'PR #418: introduce a token-bucket rate limiter on the public API gateway' },
  { id: 'issue-oauth', text: 'ENG-217: OAuth callback drops the state nonce, allowing CSRF on connect' },
  { id: 'issue-partition', text: 'ENG-233: pgvector query stopped pruning partitions after the pg16 upgrade' },
  { id: 'doc-rls', text: 'ADR-9: enforce tenant isolation with Postgres row-level security keyed on workspace_id' },
  { id: 'pr-digest', text: 'PR #431: nightly work-digest job summarizes each user recent PRs and issues' },
  { id: 'issue-webhook', text: 'ENG-240: GitHub webhook scans every workspace per delivery; add an installation index' },
  { id: 'doc-embeddings', text: 'ADR-12: store embedding_model and embedding_version per row so we can migrate embedding spaces' },
];

export const QUERIES: EvalQuery[] = [
  { query: 'how do we keep users logged in when tokens expire', relevantIds: ['pr-auth'] },
  { query: 'CSRF vulnerability in the connect flow', relevantIds: ['issue-oauth'] },
  { query: 'tenant isolation in the database', relevantIds: ['doc-rls'] },
  { query: 'vector search performance regression', relevantIds: ['issue-partition'] },
  { query: 'how are embeddings versioned for migration', relevantIds: ['doc-embeddings'] },
];
