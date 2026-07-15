import type {
  TranscriptEvent,
  MeetingLifecycleEvent,
  Participant,
} from "../types/transcriptEvent";
import { retryWithBackoff, type RetryConfig } from "../lib/retry";

export interface TranscriptStoreLike {
  openMeeting(meetingId: string): Promise<void>;
  closeMeeting(meetingId: string, status: "ended" | "ended_error"): Promise<void>;
  saveFinalEvent(event: TranscriptEvent): Promise<void>;
}

export interface TranscriptPublisherLike {
  publishTranscript(event: TranscriptEvent): Promise<void>;
  publishLifecycle(event: MeetingLifecycleEvent): Promise<void>;
}

export interface SequenceAllocatorLike {
  next(meetingId: string): Promise<number>;
}

export interface TranscriptPipelineDeps {
  store: TranscriptStoreLike;
  publisher: TranscriptPublisherLike;
  allocator: SequenceAllocatorLike;
  onAlert: (message: string, err: unknown) => void;
  postgresRetry?: RetryConfig;
  redisRetry?: RetryConfig;
}

const DEFAULT_POSTGRES_RETRY: RetryConfig = { retries: 3, baseDelayMs: 200 };
const DEFAULT_REDIS_RETRY: RetryConfig = { retries: 5, baseDelayMs: 100 };

export class TranscriptPipeline {
  private readonly postgresRetry: RetryConfig;
  private readonly redisRetry: RetryConfig;

  constructor(private readonly deps: TranscriptPipelineDeps) {
    this.postgresRetry = deps.postgresRetry ?? DEFAULT_POSTGRES_RETRY;
    this.redisRetry = deps.redisRetry ?? DEFAULT_REDIS_RETRY;
  }

  async handleMeetingStarted(
    meetingId: string,
    timestamp: number,
    participants: Participant[]
  ): Promise<void> {
    await this.deps.store.openMeeting(meetingId);
    await this.publishLifecycleWithRetry({
      type: "meeting_lifecycle",
      meetingId,
      status: "started",
      timestamp,
      participants,
    });
  }

  async handleMeetingEnded(
    meetingId: string,
    timestamp: number,
    status: "ended" | "ended_error"
  ): Promise<void> {
    await this.deps.store.closeMeeting(meetingId, status);
    await this.publishLifecycleWithRetry({
      type: "meeting_lifecycle",
      meetingId,
      status,
      timestamp,
    });
  }

  async handleTranscriptEvent(
    partial: Omit<TranscriptEvent, "sequenceNumber">
  ): Promise<void> {
    const sequenceNumber = await this.deps.allocator.next(partial.meetingId);
    const event: TranscriptEvent = { ...partial, sequenceNumber };

    if (event.isFinal) {
      try {
        await retryWithBackoff(
          () => this.deps.store.saveFinalEvent(event),
          this.postgresRetry
        );
      } catch (err) {
        this.deps.onAlert(
          "postgres persistence failed after retries, continuing live delivery",
          err
        );
      }
    }

    await retryWithBackoff(
      () => this.deps.publisher.publishTranscript(event),
      this.redisRetry
    ).catch((err) => {
      this.deps.onAlert("redis publish failed after retries", err);
      throw err;
    });
  }

  private async publishLifecycleWithRetry(
    event: MeetingLifecycleEvent
  ): Promise<void> {
    await retryWithBackoff(
      () => this.deps.publisher.publishLifecycle(event),
      this.redisRetry
    ).catch((err) => {
      this.deps.onAlert("redis publish failed after retries", err);
      throw err;
    });
  }
}
