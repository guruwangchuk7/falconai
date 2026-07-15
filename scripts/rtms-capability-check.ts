import "dotenv/config";
import * as rtms from "@zoom/rtms";

console.log("Waiting for meeting.rtms_started webhook...");

rtms.onWebhookEvent((payload: any) => {
  const event = payload.event;
  console.log("[webhook]", event, JSON.stringify(payload));
  if (event !== "meeting.rtms_started") return;

  const client = new rtms.Client();

  client.onJoinConfirm((reason: any) => {
    console.log("[onJoinConfirm] reason=", reason);
  });

  client.onAudioData((buffer: any, size: number, timestamp: number, metadata: any) => {
    console.log(
      "[onAudioData] size=",
      size,
      "timestamp=",
      timestamp,
      "metadata=",
      JSON.stringify(metadata)
    );
  });

  client.onActiveSpeakerEvent((timestamp: number, userId: any, userName: string) => {
    console.log("[onActiveSpeakerEvent]", timestamp, userId, userName);
  });

  client.onLeave((reason: any) => {
    console.log("[onLeave] reason=", reason);
  });

  client.join(payload);
});
