import type { ExtractionResult, FormattedTranscript, ParticipantMention } from "./knowledgeGraph.types";
import { retryWithBackoff, type RetryConfig } from "../lib/retry";

export interface GraphBuildStoreLike {
  findMeetingsNeedingBuild(): Promise<string[]>;
  markProcessing(meetingId: string): Promise<void>;
  markCompleted(meetingId: string): Promise<void>;
  markFailed(meetingId: string, error: string): Promise<void>;
}

export interface TranscriptFetcherLike {
  fetchFormattedTranscript(meetingId: string): Promise<FormattedTranscript>;
}

export interface DecisionExtractorLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}

export interface GraphWriterLike {
  writeGraph(meetingId: string, participants: ParticipantMention[], extraction: ExtractionResult): Promise<void>;
}

export interface KnowledgeGraphWorkerDeps {
  buildStore: GraphBuildStoreLike;
  fetcher: TranscriptFetcherLike;
  extractor: DecisionExtractorLike;
  writer: GraphWriterLike;
  onAlert: (message: string, err: unknown) => void;
  pollIntervalMs?: number;
  writerRetry?: RetryConfig;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_WRITER_RETRY: RetryConfig = { retries: 3, baseDelayMs: 200 };

export class KnowledgeGraphWorker {
  private readonly pollIntervalMs: number;
  private readonly writerRetry: RetryConfig;
  private stopped = false;

  constructor(private readonly deps: KnowledgeGraphWorkerDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.writerRetry = deps.writerRetry ?? DEFAULT_WRITER_RETRY;
  }

  async pollOnce(): Promise<void> {
    const meetingIds = await this.deps.buildStore.findMeetingsNeedingBuild();
    // Sequential by design -- see Global Constraints: this is what makes including
    // 'processing'-status meetings in the candidate query safe for crash recovery
    // without ever double-processing a build genuinely still in flight.
    for (const meetingId of meetingIds) {
      await this.processMeeting(meetingId);
    }
  }

  async processMeeting(meetingId: string): Promise<void> {
    await this.deps.buildStore.markProcessing(meetingId);
    try {
      const { promptText, participants } = await this.deps.fetcher.fetchFormattedTranscript(meetingId);
      // No extra retry layer here -- @anthropic-ai/sdk already retries 429/5xx
      // internally (default max_retries: 2), so wrapping it again would just
      // multiply attempts for no benefit. See Global Constraints.
      const extraction = await this.deps.extractor.extract(promptText);
      await retryWithBackoff(
        () => this.deps.writer.writeGraph(meetingId, participants, extraction),
        this.writerRetry
      );
      await this.deps.buildStore.markCompleted(meetingId);
    } catch (err) {
      this.deps.onAlert(`graph build failed for meeting ${meetingId}`, err);
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.buildStore.markFailed(meetingId, message);
    }
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      await this.pollOnce().catch((err) => this.deps.onAlert("knowledge graph poll tick failed", err));
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
