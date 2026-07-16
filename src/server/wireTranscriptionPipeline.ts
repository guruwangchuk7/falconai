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
  let meetingStartedAtMs = 0;
  let transcriptionManager: TranscriptionManager | undefined;

  zoomBotAdapter.on("meetingStarted", (mId, participants) => {
    meetingId = mId;
    meetingStartedAtMs = Date.now();
    transcriptionManager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs,
      meetingStartedAtMs,
      onTranscriptEvent: (event) => pipeline.handleTranscriptEvent({ ...event, meetingId }),
      now: () => Date.now(),
    });
    // The started event's timestamp is 0 by definition -- it is the reference point
    // itself, keeping lifecycle timestamps on the same meeting-relative timeline as
    // transcript startTs/endTs.
    void pipeline.handleMeetingStarted(mId, 0, participants);
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
    // Explicitly tear down all open Deepgram sessions for the ending meeting rather
    // than leaving them to the 5-minute inactivity timeout (a billable leak that
    // would otherwise become unbounded once transcriptionManager is reassigned on
    // the next meeting, making the previous meeting's sessions unreachable).
    transcriptionManager?.closeAll();
    // The ended event's timestamp is elapsed ms since the meeting started, keeping
    // it on the same meeting-relative timeline as transcript timestamps.
    void pipeline.handleMeetingEnded(meetingId, Date.now() - meetingStartedAtMs, status);
  });

  setInterval(() => transcriptionManager?.checkInactivity(Date.now()), 30_000);
}
