import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { migrate } from "../../src/db/migrate";
import { getPool, closePool } from "../../src/db/pool";
import { closeRedisClient, getRedisClient } from "../../src/redis/client";
import { ZoomBotAdapter } from "../../src/zoom/zoomBotAdapter";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import { TranscriptPipeline } from "../../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../../src/pipeline/sequenceNumberAllocator";
import type {
  RtmsClientLike,
  ZoomWebhookSource,
} from "../../src/zoom/zoomBotAdapter.types";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

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

    const transcriptionManager = new TranscriptionManager({
      mode: "per-participant",
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
      meetingStartedAtMs: 0,
      onTranscriptEvent: (event) =>
        pipeline.handleTranscriptEvent({ ...event, meetingId }),
      now: () => Date.now(),
    });

    zoomBotAdapter.on("meetingStarted", (mId, participants) =>
      pipeline.handleMeetingStarted(mId, 0, participants)
    );
    zoomBotAdapter.on("audioChunk", (participantId, buffer, timestamp) =>
      transcriptionManager.handleAudioChunk(participantId, buffer, timestamp)
    );
    zoomBotAdapter.on("meetingEnded", (status) =>
      pipeline.handleMeetingEnded(meetingId, Date.now(), status)
    );

    webhookEmitter.emit("started", {
      meetingId,
      joinPayload: {},
      participants: [{ participantId: "p1", displayName: "Alex" }],
    });
    await new Promise((r) => setTimeout(r, 10));

    webhookEmitter.emit("audio", {
      buf: Buffer.from([1, 2, 3]),
      ts: 100,
      meta: { userId: "p1", userName: "Alex" },
    });
    await new Promise((r) => setTimeout(r, 10));

    // Audio was sent at raw timestamp 100 (meetingStartedAtMs: 0), so a 50ms
    // utterance ending "now" fits within elapsed time (raw [50, 100] -> normalized [50, 100]).
    deepgramEmitter!.emit("transcript", {
      text: "hello from integration test",
      isFinal: true,
      durationMs: 50,
      confidence: 0.9,
    });
    await new Promise((r) => setTimeout(r, 10));

    webhookEmitter.emit("stopped", { meetingId });
    await new Promise((r) => setTimeout(r, 10));

    const { rows } = await pool.query(
      "SELECT text FROM transcript_events WHERE meeting_id = $1",
      [meetingId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("hello from integration test");

    const redis = await getRedisClient();
    const entries = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
    const kinds = entries.map((e) => e.message.kind);
    expect(kinds).toEqual(["meeting_lifecycle", "transcript", "meeting_lifecycle"]);
  });
});
