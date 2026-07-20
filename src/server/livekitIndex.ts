import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LiveKitBotAdapter } from "../livekit/liveKitBotAdapter";
import { createRealLiveKitRoom } from "../livekit/realLiveKitRoom";
import { createRealLiveKitWebhookSource } from "../livekit/realLiveKitWebhookSource";
import { mintParticipantToken } from "../livekit/mintToken";
import { createDeepgramSession } from "../transcription/deepgramClient";
import { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import { PostgresTranscriptStore } from "../pipeline/postgresTranscriptStore";
import { RedisTranscriptPublisher } from "../pipeline/redisTranscriptPublisher";
import { SequenceNumberAllocator } from "../pipeline/sequenceNumberAllocator";
import { wireTranscriptionPipeline } from "./wireTranscriptionPipeline";

export async function startLiveKitServer(): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  // Named distinctly from the per-request `url` declared inside the createServer
  // callback below -- both existing in the same function previously caused the inner
  // `const url = new URL(...)` to shadow this one, so the /token route ended up
  // passing the incoming request's URL object to mintParticipantToken() instead of
  // the LiveKit connection string it actually needs (and TypeScript would reject it
  // anyway, since MintTokenDeps.url is a string, not a URL).
  const liveKitUrl = process.env.LIVEKIT_URL!;
  const roomName = process.env.LIVEKIT_ROOM_NAME ?? "falcon-meet";
  const port = Number(process.env.LIVEKIT_HTTP_PORT ?? 8081);

  const { source: webhookSource, handleWebhookRequest } = createRealLiveKitWebhookSource({
    apiKey,
    apiSecret,
    botIdentity: "falcon-bot",
  });

  const liveKitBotAdapter = new LiveKitBotAdapter({
    webhookSource,
    createRoom: createRealLiveKitRoom,
    url: liveKitUrl,
  });

  const pipeline = new TranscriptPipeline({
    store: new PostgresTranscriptStore(),
    publisher: new RedisTranscriptPublisher(),
    allocator: new SequenceNumberAllocator(),
    onAlert: (message, err) => console.error(message, err),
  });

  wireTranscriptionPipeline(liveKitBotAdapter, {
    pipeline,
    createSession: (opts) => createDeepgramSession(process.env.DEEPGRAM_API_KEY!, opts),
  });

  const joinPageHtml = readFileSync(path.join(__dirname, "../../public/join.html"), "utf-8");

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/join.html")) {
      res.writeHead(200, { "Content-Type": "text/html" }).end(joinPageHtml);
      return;
    }

    if (req.method === "GET" && url.pathname === "/token") {
      const name = url.searchParams.get("name");
      if (!name) {
        res.writeHead(400).end("missing name query param");
        return;
      }
      mintParticipantToken({ apiKey, apiSecret, roomName, url: liveKitUrl }, name)
        .then(({ token, url: lkUrl }) => {
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ token, url: lkUrl }));
        })
        .catch((err) => {
          console.error("failed to mint token", err);
          res.writeHead(500).end("failed to mint token");
        });
      return;
    }

    if (req.method === "POST" && url.pathname === "/livekit-webhook") {
      void handleWebhookRequest(req, res);
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(port, () => {
    console.log(`Falcon Meet listening on http://localhost:${port} (join page + webhook)`);
  });
}

startLiveKitServer().catch((err) => {
  console.error("failed to start LiveKit server", err);
  process.exit(1);
});
