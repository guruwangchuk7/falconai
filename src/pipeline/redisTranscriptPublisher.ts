import { getRedisClient } from "../redis/client";
import type { TranscriptEvent, MeetingLifecycleEvent } from "../types/transcriptEvent";

export class RedisTranscriptPublisher {
  async publishTranscript(event: TranscriptEvent): Promise<void> {
    const client = await getRedisClient();
    await client.xAdd(`meeting:${event.meetingId}:transcript`, "*", {
      kind: "transcript",
      payload: JSON.stringify(event),
    });
  }

  async publishLifecycle(event: MeetingLifecycleEvent): Promise<void> {
    const client = await getRedisClient();
    await client.xAdd(`meeting:${event.meetingId}:transcript`, "*", {
      kind: "meeting_lifecycle",
      payload: JSON.stringify(event),
    });
  }
}
