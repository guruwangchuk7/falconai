// Verifies the transcription pipeline against REAL audio and REAL Deepgram/Postgres/Redis,
// without needing Zoom RTMS (which requires paid Developer Pack credits not available here).
// Everything downstream of ZoomBotAdapter is exercised exactly as production wires it;
// only the Zoom-specific bot-join layer is out of scope for this script.
//
// Usage: tsx scripts/live-audio-verification.ts <path-to-audio-file>
// Accepts any format ffmpeg can read (m4a, mp3, wav, ...).

import "dotenv/config";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptionManager } from "../src/transcription/transcriptionManager";
import { createDeepgramSession } from "../src/transcription/deepgramClient";
import { TranscriptPipeline } from "../src/pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../src/pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../src/pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../src/pipeline/sequenceNumberAllocator";
import { getPool, closePool } from "../src/db/pool";
import { getRedisClient, closeRedisClient } from "../src/redis/client";

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const FRAME_MS = 20;
const BYTES_PER_FRAME = SAMPLE_RATE * BYTES_PER_SAMPLE * (FRAME_MS / 1000);

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error("Usage: tsx scripts/live-audio-verification.ts <path-to-audio-file>");
    process.exit(1);
  }
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error("DEEPGRAM_API_KEY is not set in .env");
    process.exit(1);
  }

  const meetingId = `live-audio-verification-${Date.now()}`;
  const pcmPath = join(tmpdir(), "live-audio-verification.pcm");

  console.log(`Converting ${inputFile} to 16kHz mono PCM...`);
  execSync(`ffmpeg -y -i "${inputFile}" -f s16le -ar ${SAMPLE_RATE} -ac 1 "${pcmPath}"`, {
    stdio: "inherit",
  });

  const pcm = readFileSync(pcmPath);
  console.log(
    `Loaded ${pcm.length} bytes (~${(pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)).toFixed(1)}s of audio)`
  );

  const pipeline = new TranscriptPipeline({
    store: new PostgresTranscriptStore(),
    publisher: new RedisTranscriptPublisher(),
    allocator: new SequenceNumberAllocator(),
    onAlert: (message, err) => console.error("[ALERT]", message, err),
  });

  const meetingStartedAtMs = Date.now();
  await pipeline.handleMeetingStarted(meetingId, 0, [
    { participantId: "live-speaker", displayName: "Live Test Speaker" },
  ]);

  const transcriptionManager = new TranscriptionManager({
    mode: "per-participant",
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
    inactivityTimeoutMs: 60_000,
    meetingStartedAtMs,
    onTranscriptEvent: (event) => {
      console.log(`[${event.isFinal ? "FINAL" : "interim"}] ${event.text}`);
      void pipeline.handleTranscriptEvent({ ...event, meetingId });
    },
    now: () => Date.now(),
  });

  console.log("Streaming audio at real-time pace (this takes as long as the clip)...");
  let offset = 0;
  while (offset < pcm.length) {
    const frame = pcm.subarray(offset, offset + BYTES_PER_FRAME);
    transcriptionManager.handleAudioChunk("live-speaker", Buffer.from(frame), Date.now());
    offset += BYTES_PER_FRAME;
    await new Promise((r) => setTimeout(r, FRAME_MS));
  }

  console.log("Audio finished, waiting for final transcripts to flush...");
  await new Promise((r) => setTimeout(r, 3000));

  await pipeline.handleMeetingEnded(meetingId, Date.now(), "ended");
  await new Promise((r) => setTimeout(r, 1000));

  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT sequence_number, speaker_name, text, confidence FROM transcript_events WHERE meeting_id = $1 ORDER BY sequence_number",
    [meetingId]
  );
  console.log(`\n=== Postgres: ${rows.length} final transcript row(s) for ${meetingId} ===`);
  for (const row of rows) {
    console.log(`  [${row.sequence_number}] ${row.speaker_name}: "${row.text}" (confidence: ${row.confidence})`);
  }

  const redis = await getRedisClient();
  const entries = await redis.xRange(`meeting:${meetingId}:transcript`, "-", "+");
  console.log(`\n=== Redis Stream: ${entries.length} entries ===`);
  for (const e of entries) {
    console.log(`  ${e.message.kind}: ${e.message.payload.slice(0, 100)}...`);
  }

  await closePool();
  await closeRedisClient();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
