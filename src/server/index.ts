import "dotenv/config";
import { ZoomBotAdapter } from "../zoom/zoomBotAdapter";
import { createRealRtmsClient, PRODUCTION_AUDIO_PARAMS } from "../zoom/realRtmsClient";
import { createRealWebhookSource } from "../zoom/realWebhookSource";
import { createDeepgramSession } from "../transcription/deepgramClient";
import { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../pipeline/sequenceNumberAllocator";
import { wireTranscriptionPipeline } from "./wireTranscriptionPipeline";

export { wireTranscriptionPipeline } from "./wireTranscriptionPipeline";

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

  wireTranscriptionPipeline(zoomBotAdapter, {
    pipeline,
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
  });

  console.log("Falcon Transcription Service listening for RTMS webhooks");
}

startServer().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
