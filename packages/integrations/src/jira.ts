import { type ArtifactInput, type Cursor, type SourceAdapter } from './types.js';

interface JiraIssue {
  key: string;
  fields: { summary: string; description?: string | null; updated: string; project?: { key: string } };
}

/** Jira adapter — poll-only in Phase 1 (webhooks later, AD-4). One instance per connection. */
export class JiraAdapter implements SourceAdapter {
  readonly provider = 'jira' as const;
  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly apiToken: string,
  ) {}

  private auth(): string {
    return 'Basic ' + Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
  }

  async *listChanged(cursor: Cursor): AsyncIterable<ArtifactInput> {
    const jql = cursor.since ? `updated >= "${cursor.since.slice(0, 10)}"` : 'updated >= -30d';
    const url = `${this.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,updated,project`;
    const res = await fetch(url, { headers: { authorization: this.auth(), accept: 'application/json' } });
    if (!res.ok) throw new Error(`jira search failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { issues: JiraIssue[] };
    for (const issue of json.issues) {
      const project = issue.fields.project?.key ?? null;
      yield {
        source: 'jira', externalRef: issue.key, type: 'issue',
        title: issue.fields.summary, body: typeof issue.fields.description === 'string' ? issue.fields.description : null,
        repoOrProject: project, aclTags: project ? [project] : [], trustTier: 'trusted',
        sourceUpdatedAt: issue.fields.updated, ownerExternalId: null,
      };
    }
  }

  parseWebhook(): ArtifactInput[] | null {
    return null; // Jira webhooks deferred (AD-4); poll-only in Phase 1
  }
}
