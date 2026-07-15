import { EventEmitter } from "node:events";
import type {
  Participant,
  RtmsClientLike,
  ZoomWebhookSource,
} from "./zoomBotAdapter.types";

export interface ZoomBotAdapterDeps {
  webhookSource: ZoomWebhookSource;
  createClient: () => RtmsClientLike;
  audioParams: Record<string, number>;
  reconnect: { retries: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
}

const NORMAL_LEAVE_REASON = 0;

export class ZoomBotAdapter extends EventEmitter {
  private meetingId?: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ZoomBotAdapterDeps) {
    super();
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.deps.webhookSource.onRtmsStarted((payload) => this.handleRtmsStarted(payload));
    this.deps.webhookSource.onRtmsStopped((payload) => this.handleRtmsStopped(payload));
    this.deps.webhookSource.onParticipantJoined(({ participant }) =>
      this.emit("participantJoined", participant)
    );
    this.deps.webhookSource.onParticipantLeft(({ participantId }) =>
      this.emit("participantLeft", participantId)
    );
  }

  private async handleRtmsStarted(payload: {
    meetingId: string;
    joinPayload: unknown;
    participants: Participant[];
  }): Promise<void> {
    this.meetingId = payload.meetingId;
    await this.connectClient(payload.joinPayload, 0);
    this.emit("meetingStarted", payload.meetingId, payload.participants);
  }

  private handleRtmsStopped(payload: { meetingId: string }): void {
    if (payload.meetingId !== this.meetingId) return;
    this.emit("meetingEnded", "ended");
  }

  private async connectClient(joinPayload: unknown, attempt: number): Promise<void> {
    const client = this.deps.createClient();
    client.setAudioParams(this.deps.audioParams);
    client.onAudioData((buffer, _size, timestamp, metadata) => {
      this.emit("audioChunk", metadata.userId, buffer, timestamp);
    });
    client.onActiveSpeakerEvent((timestamp, userId) => {
      this.emit("activeSpeaker", userId, timestamp);
    });
    client.onLeave((reason) => {
      if (reason === NORMAL_LEAVE_REASON) return;
      this.retryConnect(joinPayload, attempt, new Error(`unexpected leave, reason=${reason}`));
    });

    try {
      await client.join(joinPayload);
    } catch (err) {
      await this.retryConnect(joinPayload, attempt, err);
    }
  }

  private async retryConnect(joinPayload: unknown, attempt: number, _err: unknown): Promise<void> {
    if (attempt >= this.deps.reconnect.retries) {
      this.emit("meetingEnded", "ended_error");
      return;
    }
    await this.sleep(this.deps.reconnect.baseDelayMs * 2 ** attempt);
    await this.connectClient(joinPayload, attempt + 1);
  }
}
