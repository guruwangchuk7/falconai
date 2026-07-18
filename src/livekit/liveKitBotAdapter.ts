import { EventEmitter } from "node:events";
import type {
  LiveKitParticipant,
  LiveKitRoomLike,
  LiveKitWebhookSource,
} from "./liveKitBotAdapter.types";

export interface LiveKitBotAdapterDeps {
  webhookSource: LiveKitWebhookSource;
  createRoom: () => LiveKitRoomLike;
  url: string;
}

export class LiveKitBotAdapter extends EventEmitter {
  private meetingId?: string;
  private room?: LiveKitRoomLike;

  constructor(private readonly deps: LiveKitBotAdapterDeps) {
    super();
    this.deps.webhookSource.onRoomStarted((payload) => this.handleRoomStarted(payload));
    this.deps.webhookSource.onRoomFinished((payload) => this.handleRoomFinished(payload));
    this.deps.webhookSource.onParticipantJoined(({ meetingId, participant }) => {
      if (meetingId !== this.meetingId) return;
      this.emit("participantJoined", participant);
    });
    this.deps.webhookSource.onParticipantLeft(({ meetingId, participantId }) => {
      if (meetingId !== this.meetingId) return;
      this.emit("participantLeft", participantId);
    });
  }

  private async handleRoomStarted(payload: {
    meetingId: string;
    botToken: string;
    participants: LiveKitParticipant[];
  }): Promise<void> {
    this.meetingId = payload.meetingId;
    const room = this.deps.createRoom();
    room.onAudioData((participantId, buffer, timestamp) => {
      this.emit("audioChunk", participantId, buffer, timestamp);
    });
    room.onDisconnected((reason) => this.handleDisconnected(reason));
    try {
      await room.connect(this.deps.url, payload.botToken);
    } catch (err) {
      console.error("LiveKitBotAdapter: room.connect() failed", err);
      this.meetingId = undefined;
      this.emit("meetingEnded", "ended_error");
      return;
    }
    this.room = room;
    this.emit("meetingStarted", payload.meetingId, payload.participants);
  }

  private handleRoomFinished(payload: { meetingId: string }): void {
    if (payload.meetingId !== this.meetingId) return;
    this.room?.disconnect().catch((err) => {
      console.error("LiveKitBotAdapter: room.disconnect() failed", err);
    });
    this.room = undefined;
    this.emit("meetingEnded", "ended");
  }

  private handleDisconnected(_reason: string): void {
    // @livekit/rtc-node's Room handles reconnection internally (Reconnecting/Reconnected
    // fire for transient issues); Disconnected only fires once the SDK has given up, so
    // this is already the terminal signal -- no separate retry loop needed here, unlike
    // ZoomBotAdapter's manual reconnectAttempt/backoff (verify this against Task 1's
    // findings before relying on it in production).
    this.room = undefined;
    this.emit("meetingEnded", "ended_error");
  }
}
