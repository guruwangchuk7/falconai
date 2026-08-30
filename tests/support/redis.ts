import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export interface TestRedis {
  container: StartedTestContainer;
  url: string;
  stop(): Promise<void>;
}

/**
 * Boots a throwaway Redis (for the rate limiter / queue connection in the authed e2e). Lives here
 * in tests/support so `testcontainers` resolves from the repo-root node_modules — the same reason
 * pg.ts lives here rather than under apps/web. Requires a Docker host.
 */
export async function startTestRedis(): Promise<TestRedis> {
  const container = await new GenericContainer('redis:7').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  return {
    container,
    url,
    async stop() {
      await container.stop();
    },
  };
}
