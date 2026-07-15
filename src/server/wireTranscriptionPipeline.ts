import type { ZoomBotAdapter } from "../zoom/zoomBotAdapter";
import { TranscriptionManager } from "../transcription/transcriptionManager";
import type { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import type { DeepgramLiveConnectionLike } from "../transcription/deepgramLiveConnection.types";

/**
 * Wires a (real or fake) ZoomBotAdapter to a TranscriptPipeline, constructing a fresh
 * TranscriptionManager once the real meeting start time is known.
 *
 * Deliberately kept in its own module, separate from `./index.ts`: `index.ts` also
 * statically imports `../zoom/realRtmsClient` and `../zoom/realWebhookSource`, both of
 * which import the `@zoom/rtms` native binary at module scope — so merely importing
 * `index.ts` fails immediately wherever that binary isn't available (confirmed in Task
 * 1: it isn't, on this Windows dev environment). This module has no such import, so
 * tests can exercise the real wiring logic against a synthetic ZoomBotAdapter without
 * ever touching `@zoom/rtms`.
 */
export function wireTranscriptionPipeline(
  zoomBotAdapter: ZoomBotAdapter,
  deps: {
    pipeline: TranscriptPipeline;
    createSession: (opts: { diarize: boolean }) => DeepgramLiveConnectionLike;
    inactivityTimeoutMs?: number;
  }
): void {
  const { pipeline, createSession, inactivityTimeoutMs = 5 * 60_000 } = deps;

  let meetingId = "";
  let transcriptionManager: TranscriptionManager | undefined;

  zoomBotAdapter.on("meetingStarted", (mId, participants) => {
    meetingId = mId;
    const meetingStartedAtMs = Date.now();
    transcriptionManager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs,
      meetingStartedAtMs,
      onTranscriptEvent: (event) => pipeline.handleTranscriptEvent({ ...event, meetingId }),
      now: () => Date.now(),
    });
    void pipeline.handleMeetingStarted(mId, meetingStartedAtMs, participants);
  });
  zoomBotAdapter.on("audioChunk", (participantId, buffer, timestamp) => {
    transcriptionManager?.handleAudioChunk(participantId, buffer, timestamp);
  });
  zoomBotAdapter.on("activeSpeaker", (participantId, timestamp) => {
    transcriptionManager?.handleActiveSpeaker(participantId, timestamp);
  });
  zoomBotAdapter.on("participantLeft", (participantId) => {
    transcriptionManager?.handleParticipantLeft(participantId);
  });
  zoomBotAdapter.on("meetingEnded", (status) => {
    void pipeline.handleMeetingEnded(meetingId, Date.now(), status);
  });

  setInterval(() => transcriptionManager?.checkInactivity(Date.now()), 30_000);
}
