import { LinearClient } from '@linear/sdk';
import { type ArtifactInput, type Cursor, type SourceAdapter } from './types.js';

/** Linear adapter. One instance per connection (holds the access token via LinearClient). */
export class LinearAdapter implements SourceAdapter {
  readonly provider = 'linear' as const;
  constructor(private readonly client: LinearClient) {}

  async *listChanged(cursor: Cursor): AsyncIterable<ArtifactInput> {
    const filter = cursor.since ? { updatedAt: { gte: new Date(cursor.since) } } : undefined;
    const page = await this.client.issues({ first: 100, ...(filter ? { filter } : {}) });
    for (const issue of page.nodes) {
      // team prefix (e.g. "ENG" from "ENG-217") is a cheap per-project ACL tag.
      const project = issue.identifier.split('-')[0] ?? null;
      const ws = await issue.state; // WorkflowState
      const stateType = ws?.type ?? null; // triage|backlog|unstarted|started|completed|canceled
      const mergedClosedAt = (stateType === 'completed' || stateType === 'canceled')
        ? (issue.completedAt?.toISOString() ?? issue.updatedAt.toISOString())
        : null;
      yield {
        source: 'linear',
        externalRef: issue.identifier,
        type: 'issue',
        title: issue.title,
        body: issue.description ?? null,
        repoOrProject: project,
        aclTags: project ? [project] : [],
        trustTier: 'trusted', // team-authored work item
        sourceUpdatedAt: issue.updatedAt.toISOString(),
        ownerExternalId: null, // deep creator/assignee resolution deferred (avoids N+1 in Phase 1)
        state: stateType,
        mergedClosedAt,
      };
    }
  }

  parseWebhook(payload: unknown): ArtifactInput[] | null {
    const e = payload as { type?: string; data?: { identifier?: string; title?: string; description?: string | null; updatedAt?: string } };
    if (e.type === 'Issue' && e.data?.identifier) {
      const project = e.data.identifier.split('-')[0] ?? null;
      return [{
        source: 'linear', externalRef: e.data.identifier, type: 'issue',
        title: e.data.title ?? null, body: e.data.description ?? null,
        repoOrProject: project, aclTags: project ? [project] : [], trustTier: 'trusted',
        sourceUpdatedAt: e.data.updatedAt ?? null, ownerExternalId: null,
      }];
    }
    return null;
  }
}
