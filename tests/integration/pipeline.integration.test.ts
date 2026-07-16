import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import { ZoomBotAdapter } from "../../src/zoom/zoomBotAdapter";
import { wireTranscriptionPipeline } from "../../src/server/wireTranscriptionPipeline";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import type {
  RtmsClientLike,
  ZoomWebhookSource,
} from "../../src/zoom/zoomBotAdapter.types";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

// TranscriptionManager -> TranscriptPipeline delivery is fire-and-forget by design
// (onTranscriptEvent is typed `() => void`; production code never awaits it, since a
// transcript handler shouldn't block on network I/O). So this test can't know exactly
// when the resulting Postgres INSERT / Redis XADD has landed -- it must poll for the
// actual data rather than guess a fixed delay (a fixed setTimeout here was flaky:
// passed reliably on some machines/runs, occasionally read the assertion before the
// async write completed on others).
async function waitFor<T>(
  condition: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 3000
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = await condition();
    if (result) return result as T;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("end-to-end pipeline wiring", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
    await closeRedisClient();
  });

  it("carries a synthetic meeting from Zoom events to the Redis Stream and Postgres", async () => {
    const meetingId = "integration-test-1";

    // Clean up state left by prior runs of this same test (SequenceNumberAllocator's
    // Redis INCR counter and Postgres rows both persist across test invocations),
    // so the assertions below are deterministic regardless of how many times this
    // test has previously run against this database/Redis instance.
    const pool = getPool();
    await pool.query("DELETE FROM transcript_events WHERE meeting_id = $1", [meetingId]);
    await pool.query("DELETE FROM meetings WHERE meeting_id = $1", [meetingId]);
    const redisForCleanup = await getRedisClient();
    await redisForCleanup.del(`meeting:${meetingId}:transcript`);
    await redisForCleanup.del(`meeting:${meetingId}:seq`);

    const webhookEmitter = new EventEmitter();
    const webhookSource: ZoomWebhookSource = {
      onRtmsStarted: (cb) => webhookEmitter.on("started", cb),
      onRtmsStopped: (cb) => webhookEmitter.on("stopped", cb),
      onParticipantJoined: (cb) => webhookEmitter.on("joined", cb),
      onParticipantLeft: (cb) => webhookEmitter.on("left", cb),
    };

    let deepgramEmitter: EventEmitter | undefined;
    const fakeRtmsClient: RtmsClientLike = {
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn(),
      setAudioParams: vi.fn(),
      onAudioData: (cb) =>
        webhookEmitter.on("audio", ({ buf, ts, meta }) => cb(buf, buf.length, ts, meta)),
      onActiveSpeakerEvent: vi.fn(),
      onJoinConfirm: vi.fn(),
      onLeave: vi.fn(),
    };

    const zoomBotAdapter = new ZoomBotAdapter({
      webhookSource,
      createClient: () => fakeRtmsClient,
      audioParams: {},
      reconnect: { retries: 1, baseDelayMs: 1 },
    });

    const pipeline = new TranscriptPipeline({
      store: new PostgresTranscriptStore(),
      publisher: new RedisTranscriptPublisher(),
      allocator: new SequenceNumberAllocator(),
      onAlert: (msg, err) => console.error(msg, err),
      postgresRetry: { retries: 1, baseDelayMs: 1 },
      redisRetry: { retries: 1, baseDelayMs: 1 },
    });

    // Exercise the actual production composition-root wiring (src/server/index.ts's
    // wireTranscriptionPipeline) rather than re-implementing the event wiring inline,
    // so a regression like meetingStartedAtMs being frozen at construction time would
    // be caught here.
    wireTranscriptionPipeline(zoomBotAdapter, {
      pipeline,
      createSession: (): DeepgramLiveConnectionLike => {
        deepgramEmitter = new EventEmitter();
        return {
          onTranscript: (cb) => deepgramEmitter!.on("transcript", cb),
          onError: (cb) => deepgramEmitter!.on("error", cb),
          onClose: (cb) => deepgramEmitter!.on("close", cb),
          send: vi.fn(),
          finish: vi.fn(),
        };
      },
      inactivityTimeoutMs: 60_000,
    });

    webhookEmitter.emit("started", {
      meetingId,
      joinPayload: {},
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
    // wireTranscriptionPipeline constructs the TranscriptionManager (and captures
    // meetingStartedAtMs = Date.now()) inside the "meetingStarted" handler, which
    // fires asynchronously (ZoomBotAdapter awaits the fake client's join() promise
    // first) -- so wait for that to settle before sending audio.
    await new Promise((r) => setTimeout(r, 50));

    // Audio is sent with a real, current raw timestamp -- matching how the real
    // ZoomBotAdapter/RTMS client hand Zoom's own wall-clock timestamps to
    // TranscriptionManager. meetingStartedAtMs is likewise a real Date.now() value
    // now (captured inside wireTranscriptionPipeline's "meetingStarted" handler),
    // so normalizeTimestamp's elapsed-time math (rawTs - meetingStartedAtMs) works
    // out to a small, sane, non-negative number, the same shape it would take in
    // production. This exercises the fix for meetingStartedAtMs previously being
    // frozen at the literal 0 -- with that bug, meetingStartedAtMs would never
    // match the epoch these raw timestamps are drawn from.
    const audioTs = Date.now();
    webhookEmitter.emit("audio", {
      buf: Buffer.from([1, 2, 3]),
      ts: audioTs,
      meta: { userId: "p1", userName: "Alex" },
    });
    await new Promise((r) => setTimeout(r, 10));

    // A 20ms utterance ending at audioTs comfortably postdates meetingStartedAtMs
    // (which was captured at least ~50ms earlier), so normalizeTimestamp's
    // elapsed-time computation stays positive with real wall-clock margin.
    deepgramEmitter!.emit("transcript", {
      text: "hello from integration test",
      isFinal: true,
      durationMs: 20,
      confidence: 0.9,
    });

    // Wait for the fire-and-forget Postgres write to actually land, rather than
    // guessing a delay -- see the `waitFor` doc comment above.
    const rows = await waitFor(async () => {
      const { rows } = await pool.query(
        "SELECT text FROM transcript_events WHERE meeting_id = $1",
        [meetingId]
      );
      return rows.length > 0 ? rows : false;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("hello from integration test");

    webhookEmitter.emit("stopped", { meetingId });

    const redis = await getRedisClient();
    // Same reasoning: wait for the closing meeting_lifecycle entry to actually be
    // published rather than guessing a delay.
    const entries = await waitFor(async () => {
      const es = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
      return es.length >= 3 ? es : false;
    });
    const kinds = entries.map((e) => e.message.kind);
    expect(kinds).toEqual(["meeting_lifecycle", "transcript", "meeting_lifecycle"]);
  });
});
