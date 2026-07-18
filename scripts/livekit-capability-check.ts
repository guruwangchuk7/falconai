// scripts/livekit-capability-check.ts
import "dotenv/config";
import { Room, RoomEvent, AudioStream, RemoteAudioTrack } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

async function main() {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const url = process.env.LIVEKIT_URL!;
  const roomName = process.env.LIVEKIT_ROOM_NAME ?? "falcon-meet";

  const botToken = new AccessToken(apiKey, apiSecret, { identity: "falcon-bot" });
  botToken.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  const botJwt = await botToken.toJwt();

  const humanToken = new AccessToken(apiKey, apiSecret, { identity: "human-tester", name: "Human Tester" });
  humanToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const humanJwt = await humanToken.toJwt();

  const room = new Room();

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log("[participantConnected]", participant.identity, participant.name);
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log("[participantDisconnected]", participant.identity);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log("[trackSubscribed]", participant.identity, publication.kind);
    if (track instanceof RemoteAudioTrack) {
      const stream = new AudioStream(track, 16000, 1);
      let frameCount = 0;
      void (async () => {
        for await (const frame of stream) {
          frameCount += 1;
          if (frameCount % 50 === 0) {
            console.log(
              `[audioFrame] from ${participant.identity}: count=${frameCount} sampleRate=${frame.sampleRate} channels=${frame.channels} samplesPerChannel=${frame.samplesPerChannel}`
            );
          }
        }
        console.log(`[audioStream ended] ${participant.identity}, total frames=${frameCount}`);
      })();
    }
  });
  room.on(RoomEvent.Reconnecting, () => console.log("[reconnecting]"));
  room.on(RoomEvent.Reconnected, () => console.log("[reconnected]"));
  room.on(RoomEvent.Disconnected, (reason) => console.log("[disconnected]", reason));

  console.log(`Connecting bot to room "${roomName}"...`);
  await room.connect(url, botJwt);
  console.log("Bot connected.");
  console.log("");
  console.log("Now join the same room as a human: go to https://meet.livekit.io, choose");
  console.log('"Manual" / custom connection, and enter:');
  console.log("  Server URL:", url);
  console.log("  Token:", humanJwt);
  console.log("");
  console.log("Speak for 10-20 seconds, then press Ctrl+C here to stop.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
