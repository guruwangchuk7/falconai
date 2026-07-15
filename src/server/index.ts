import "dotenv/config";
import { ZoomBotAdapter } from "../zoom/zoomBotAdapter";
import { createRealRtmsClient, PRODUCTION_AUDIO_PARAMS } from "../zoom/realRtmsClient";
import { createRealWebhookSource } from "../zoom/realWebhookSource";
import { TranscriptionManager } from "../transcription/transcriptionManager";
import { createDeepgramSession } from "../transcription/deepgramClient";
import { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../pipeline/sequenceNumberAllocator";

export async function startServer(): Promise<void> {
  const zoomBotAdapter = new ZoomBotAdapter({
    webhookSource: createRealWebhookSource(),
    createClient: createRealRtmsClient,
    audioParams: PRODUCTION_AUDIO_PARAMS,
    reconnect: { retries: 5, baseDelayMs: 500 },
  });

  const pipeline = new TranscriptPipeline({
    store: new PostgresTranscriptStore(),
    publisher: new RedisTranscriptPublisher(),
    allocator: new SequenceNumberAllocator(),
    onAlert: (message, err) => console.error(message, err),
  });

  let meetingId = "";
  let meetingStartedAtMs = 0;
  const transcriptionManager = new TranscriptionManager({
    mode: "per-participant",
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
    inactivityTimeoutMs: 5 * 60_000,
    meetingStartedAtMs: 0,
    onTranscriptEvent: (event) => pipeline.handleTranscriptEvent({ ...event, meetingId }),
    now: () => Date.now(),
  });

  zoomBotAdapter.on("meetingStarted", (mId, participants) => {
    meetingId = mId;
    meetingStartedAtMs = Date.now();
    void pipeline.handleMeetingStarted(mId, meetingStartedAtMs, participants);
  });
  zoomBotAdapter.on("audioChunk", (participantId, buffer, timestamp) => {
    transcriptionManager.handleAudioChunk(participantId, buffer, timestamp);
  });
  zoomBotAdapter.on("activeSpeaker", (participantId, timestamp) => {
    transcriptionManager.handleActiveSpeaker(participantId, timestamp);
  });
  zoomBotAdapter.on("participantLeft", (participantId) => {
    transcriptionManager.handleParticipantLeft(participantId);
  });
  zoomBotAdapter.on("meetingEnded", (status) => {
    void pipeline.handleMeetingEnded(meetingId, Date.now(), status);
  });

  setInterval(() => transcriptionManager.checkInactivity(Date.now()), 30_000);

  console.log("Falcon Transcription Service listening for RTMS webhooks");
}

startServer().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
