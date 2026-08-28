import type { Octokit } from 'octokit';
import { type ArtifactInput, type Cursor, type SourceAdapter, trustFor } from './types.js';

export interface GitHubRepo { owner: string; repo: string }

// Minimal shapes for the fields we read (decoupled from Octokit's heavy generics).
interface GhPull { number: number; title: string; body: string | null; updated_at: string; user: { login: string } | null }
interface GhCommit { sha: string; commit: { message: string; author: { date?: string } | null }; author: { login: string } | null }
interface GhReviewComment { id: number; body: string; updated_at: string; user: { login: string } | null }

/** GitHub App (repo-scoped) adapter. Construct with an installation-scoped Octokit (built by the
 *  worker from the App creds + the connection's installation id). One instance per connection. */
export class GitHubAdapter implements SourceAdapter {
  readonly provider = 'github' as const;
  constructor(
    private readonly octokit: Octokit,
    private readonly repos: GitHubRepo[],
    private readonly memberLogins: Set<string>,
  ) {}

  async *listChanged(cursor: Cursor): AsyncIterable<ArtifactInput> {
    const since = cursor.since;
    for (const { owner, repo } of this.repos) {
      const slug = `${owner}/${repo}`;

      const prs = (await this.octokit.paginate(this.octokit.rest.pulls.list, {
        owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 50,
      })) as unknown as GhPull[];
      for (const pr of prs) {
        if (since && pr.updated_at < since) break; // sorted desc by updated
        const login = pr.user?.login ?? null;
        yield {
          source: 'github', externalRef: `#${pr.number}`, type: 'pr',
          title: pr.title, body: pr.body ?? null, repoOrProject: slug, aclTags: [slug],
          trustTier: trustFor('pr', login ? this.memberLogins.has(login) : false),
          sourceUpdatedAt: pr.updated_at, ownerExternalId: login,
        };
      }

      const commits = (await this.octokit.paginate(this.octokit.rest.repos.listCommits, {
        owner, repo, per_page: 50, ...(since ? { since } : {}),
      })) as unknown as GhCommit[];
      for (const c of commits) {
        yield {
          source: 'github', externalRef: c.sha.slice(0, 10), type: 'commit',
          title: c.commit.message.split('\n')[0] ?? null, body: c.commit.message,
          repoOrProject: slug, aclTags: [slug], trustTier: 'mixed',
          sourceUpdatedAt: c.commit.author?.date ?? null, ownerExternalId: c.author?.login ?? null,
        };
      }

      const comments = (await this.octokit.paginate(this.octokit.rest.pulls.listReviewCommentsForRepo, {
        owner, repo, sort: 'updated', direction: 'desc', per_page: 50, ...(since ? { since } : {}),
      })) as unknown as GhReviewComment[];
      for (const rc of comments) {
        yield {
          source: 'github', externalRef: `rc-${rc.id}`, type: 'review_comment',
          title: null, body: rc.body, repoOrProject: slug, aclTags: [slug],
          trustTier: 'untrusted', sourceUpdatedAt: rc.updated_at, ownerExternalId: rc.user?.login ?? null,
        };
      }
    }
  }

  parseWebhook(payload: unknown): ArtifactInput[] | null {
    const e = payload as { pull_request?: GhPull; repository?: { full_name: string } };
    if (e.pull_request && e.repository) {
      const slug = e.repository.full_name;
      const pr = e.pull_request;
      const login = pr.user?.login ?? null;
      return [{
        source: 'github', externalRef: `#${pr.number}`, type: 'pr',
        title: pr.title, body: pr.body ?? null, repoOrProject: slug, aclTags: [slug],
        trustTier: trustFor('pr', login ? this.memberLogins.has(login) : false),
        sourceUpdatedAt: pr.updated_at, ownerExternalId: login,
      }];
    }
    return null;
  }
}
