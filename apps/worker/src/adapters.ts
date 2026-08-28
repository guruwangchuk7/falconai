import { App } from 'octokit';
import { LinearClient } from '@linear/sdk';
import { GitHubAdapter, JiraAdapter, LinearAdapter, type SourceAdapter } from '@falcon/integrations';
import type { SecretStore } from '@falcon/secrets';
import { githubEnv, loadEnv } from '@falcon/config';

export interface ConnectionRow {
  id: string;
  provider: 'github' | 'linear' | 'jira';
  userId: string;
  externalAccountRef: string | null;
  secretRef: string | null;
}

/** Build a per-connection source adapter, pulling the OAuth token from the secrets store. */
export async function buildAdapter(conn: ConnectionRow, secrets: SecretStore, memberLogins: Set<string>): Promise<SourceAdapter> {
  switch (conn.provider) {
    case 'github': {
      const env = loadEnv(githubEnv);
      const app = new App({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY });
      const installationId = Number(conn.externalAccountRef);
      const octokit = await app.getInstallationOctokit(installationId);
      const repos = (
        (await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, { per_page: 100 })) as unknown as Array<{ owner: { login: string }; name: string }>
      ).map((r) => ({ owner: r.owner.login, repo: r.name }));
      return new GitHubAdapter(octokit, repos, memberLogins);
    }
    case 'linear': {
      if (!conn.secretRef) throw new Error('linear connection missing secretRef');
      const token = (await secrets.get(conn.secretRef)).accessToken;
      return new LinearAdapter(new LinearClient({ apiKey: token }));
    }
    case 'jira': {
      if (!conn.secretRef) throw new Error('jira connection missing secretRef');
      const t = await secrets.get(conn.secretRef);
      return new JiraAdapter(t.meta?.baseUrl ?? '', t.meta?.email ?? '', t.accessToken);
    }
  }
}
