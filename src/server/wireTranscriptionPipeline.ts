import type { Participant } from "../types/transcriptEvent";
import { TranscriptionManager } from "../transcription/transcriptionManager";
import type { TranscriptPipeline } from "../pipeline/transcriptPipeline";
import type { DeepgramLiveConnectionLike } from "../transcription/deepgramLiveConnection.types";

/**
 * The event surface any meeting-source adapter must emit for wireTranscriptionPipeline
 * to drive TranscriptionManager/TranscriptPipeline from it. Both ZoomBotAdapter and
 * LiveKitBotAdapter satisfy this structurally (they extend EventEmitter and emit these
 * exact events) without needing to declare `implements MeetingSourceAdapter` themselves.
 */
export interface MeetingSourceAdapter {
  on(
    event: "meetingStarted",
    listener: (meetingId: string, participants: Participant[]) => void
  ): this;
  on(
    event: "audioChunk",
    listener: (participantId: string, buffer: Buffer, timestamp: number) => void
  ): this;
  on(
    event: "activeSpeaker",
    listener: (participantId: string, timestamp: number) => void
  ): this;
  on(event: "participantLeft", listener: (participantId: string) => void): this;
  on(
    event: "meetingEnded",
    listener: (status: "ended" | "ended_error") => void
  ): this;
}

/**
 * Wires a (real or fake) MeetingSourceAdapter to a TranscriptPipeline, constructing a
 * fresh TranscriptionManager once the real meeting start time is known.
 *
 * Deliberately kept in its own module, separate from `./index.ts`: `index.ts` also
 * statically imports `../zoom/realRtmsClient` and `../zoom/realWebhookSource`, both of
 * which import the `@zoom/rtms` native binary at module scope — so merely importing
 * `index.ts` fails immediately wherever that binary isn't available (confirmed in Task
 * 1: it isn't, on this Windows dev environment). This module has no such import, so
 * tests can exercise the real wiring logic against a synthetic MeetingSourceAdapter
 * without ever touching `@zoom/rtms`.
 */
export function wireTranscriptionPipeline(
  meetingSourceAdapter: MeetingSourceAdapter,
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

  meetingSourceAdapter.on("meetingStarted", (mId, participants) => {
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
  meetingSourceAdapter.on("audioChunk", (participantId, buffer, timestamp) => {
    transcriptionManager?.handleAudioChunk(participantId, buffer, timestamp);
  });
  meetingSourceAdapter.on("activeSpeaker", (participantId, timestamp) => {
    transcriptionManager?.handleActiveSpeaker(participantId, timestamp);
  });
  meetingSourceAdapter.on("participantLeft", (participantId) => {
    transcriptionManager?.handleParticipantLeft(participantId);
  });
  meetingSourceAdapter.on("meetingEnded", (status) => {
    // Explicitly tear down all open Deepgram sessions for the ending meeting rather
    // than leaving them to the 5-minute inactivity timeout (a billable leak that
    // would otherwise become unbounded once transcriptionManager is reassigned on
    // the next meeting, making the previous meeting's sessions unreachable).
    transcriptionManager?.closeAll();
    // Clear the reference so any late audioChunk/activeSpeaker/participantLeft event
    // arriving after this point (e.g. a straggling webhook delivery) is a no-op
    // instead of silently re-opening -- and then leaking -- a new session via the
    // optional-chained handlers above.
    transcriptionManager = undefined;
    // The ended event's timestamp is normally elapsed ms since the meeting started,
    // keeping it on the same meeting-relative timeline as transcript timestamps. But
    // meetingEnded can fire without a prior meetingStarted -- e.g. ZoomBotAdapter
    // emits "ended_error" when it exhausts reconnect retries before ever completing a
    // join, in which case meetingStartedAtMs is still its initial 0. Guard against
    // computing a nonsensical elapsed time relative to the Unix epoch in that case
    // (meetingStartedAtMs is always Date.now()-derived and thus > 0 once a meeting has
    // actually started).
    const elapsedMs = meetingStartedAtMs > 0 ? Date.now() - meetingStartedAtMs : 0;
    void pipeline.handleMeetingEnded(meetingId, elapsedMs, status);
  });

  setInterval(() => transcriptionManager?.checkInactivity(Date.now()), 30_000);
}
