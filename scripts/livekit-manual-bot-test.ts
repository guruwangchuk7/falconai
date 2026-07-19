// Manual spike: connects a bot directly to the LiveKit room, bypassing
// LiveKitBotAdapter/the webhook entirely, to test the AudioStream -> Deepgram path
// in isolation from webhook-delivery issues. Not part of production wiring (see
// src/server/livekitIndex.ts for that) -- a debugging tool, mirroring
// scripts/livekit-capability-check.ts and scripts/live-audio-verification.ts.
import "dotenv/config";
import { AccessToken } from "livekit-server-sdk";
import { createRealLiveKitRoom } from "../src/livekit/realLiveKitRoom";
import { createDeepgramSession } from "../src/transcription/deepgramClient";

async function main() {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const url = process.env.LIVEKIT_URL!;
  const roomName = process.env.LIVEKIT_ROOM_NAME ?? "falcon-meet";
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY!;

  const botToken = new AccessToken(apiKey, apiSecret, { identity: "falcon-bot-manual" });
  botToken.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  const jwt = await botToken.toJwt();

  const room = createRealLiveKitRoom();
  const dgSession = createDeepgramSession(deepgramApiKey, { diarize: false });

  dgSession.onTranscript((payload) => {
    console.log("[manual test transcript]", JSON.stringify(payload));
  });
  dgSession.onError((err) => console.error("[manual test dg error]", err));
  dgSession.onClose(() => console.log("[manual test dg closed]"));

  room.onAudioData((participantId, buffer) => {
    dgSession.send(buffer);
  });
  room.onDisconnected((reason) => console.log("[manual test room disconnected]", reason));

  console.log(`Connecting bot manually to room "${roomName}"...`);
  await room.connect(url, jwt);
  console.log("Bot connected. Listening for audio -- speak now. Ctrl+C to stop.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
