import { startTestDb, type TestDb } from './pg.js';
import { startTestRedis, type TestRedis } from './redis.js';
import { FakeSttProvider, type FakeSttStream } from '@falcon/stt';

export interface FakeClient {
  userId: string;
  stream: FakeSttStream;
  /** Simulate this client finishing an utterance with the given transcript (attributed to userId). */
  speak(clientSeq: number, text: string): void;
}

export interface TwoClientHarness {
  db: TestDb;
  redis: TestRedis;
  stt: FakeSttProvider;
  clients: [FakeClient, FakeClient];
  stop(): Promise<void>;
}

/**
 * Boots the infra (pgvector + Redis via Testcontainers) and a keyless fake STT with two simulated
 * clients, for deterministic Phase-3 pairing tests (attribution, merge, thread tracking). The session
 * worker (built in later tasks) consumes these streams; until then this exercises the fake-client
 * side. Requires a Docker host. Mirrors the `FALCON_FAKE_LLM` seam used by the Phase-2 e2e.
 *
 * TODO(T009+): layer 0002_personal_falcon.sql + 0003_pairing.sql on top of pg.ts's 0001 base so the
 * pairing tables exist for the RLS / visibility-scope integration tests.
 */
export async function startTwoClientHarness(
  userIds: readonly [string, string] = ['user-a', 'user-b'],
): Promise<TwoClientHarness> {
  const [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
  const stt = new FakeSttProvider();

  const makeClient = (userId: string): FakeClient => {
    const stream = stt.openStream({ userId }) as FakeSttStream;
    return { userId, stream, speak: (clientSeq, text) => stream.feedFinal(clientSeq, text) };
  };

  const clients: [FakeClient, FakeClient] = [makeClient(userIds[0]), makeClient(userIds[1])];

  return {
    db,
    redis,
    stt,
    clients,
    async stop() {
      await Promise.all([db.stop(), redis.stop()]);
    },
  };
}
