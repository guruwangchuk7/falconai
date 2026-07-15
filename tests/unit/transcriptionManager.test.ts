// tests/unit/transcriptionManager.test.ts
import { describe, it, expect, vi } from "vitest";
import { TranscriptionManager } from "../../src/transcription/transcriptionManager";
import type { DeepgramLiveConnectionLike } from "../../src/transcription/deepgramLiveConnection.types";

function makeFakeSession() {
  const handlers: Record<string, Function> = {};
  const send = vi.fn();
  const finish = vi.fn();
  const connection: DeepgramLiveConnectionLike = {
    onTranscript: (cb) => (handlers.transcript = cb),
    onError: (cb) => (handlers.error = cb),
    onClose: (cb) => (handlers.close = cb),
    send,
    finish,
  };
  return { connection, handlers, send, finish };
}

describe("TranscriptionManager (per-participant mode)", () => {
  it("opens one Deepgram session per participant and normalizes results", () => {
    const sessions: Record<string, ReturnType<typeof makeFakeSession>> = {};
    const createSession = vi.fn((opts: { diarize: boolean }) => {
      const s = makeFakeSession();
      sessions[Object.keys(sessions).length === 0 ? "p1" : "p2"] = s;
      return s.connection;
    });
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 1000,
      onTranscriptEvent,
      now: () => 1000,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 1500);
    manager.handleAudioChunk("p2", Buffer.from([2]), 1600);

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(sessions.p1.send).toHaveBeenCalledWith(Buffer.from([1]));
    expect(sessions.p2.send).toHaveBeenCalledWith(Buffer.from([2]));

    // p1's last audio chunk was sent at raw timestamp 1500 (meetingStartedAtMs: 1000
    // below), so a 500ms utterance ending "now" spans raw [1000, 1500] -> normalized [0, 500].
    sessions.p1.handlers.transcript({
      text: "hello",
      isFinal: true,
      durationMs: 500,
      confidence: 0.9,
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith({
      version: 1,
      utteranceId: expect.any(String),
      participantId: "p1",
      speakerName: "p1",
      text: "hello",
      isFinal: true,
      startTs: 0,
      endTs: 500,
      confidence: 0.9,
      source: "deepgram",
    });
  });

  it("closes a participant's session immediately when they leave", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => 0,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    manager.handleParticipantLeft("p1");

    expect(s1.finish).toHaveBeenCalled();
  });

  it("discards late transcripts arriving after session teardown without crashing", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 1000,
      onTranscriptEvent,
      now: () => 1000,
    });

    // Send audio from participant, capturing the transcript handler.
    manager.handleAudioChunk("p1", Buffer.from([1]), 1500);
    const transcriptHandler = s1.handlers.transcript;

    // Close the session by removing the participant.
    manager.handleParticipantLeft("p1");

    // Fire a late/trailing transcript callback simulating STT connection firing after teardown.
    // This should not call onTranscriptEvent and should not throw.
    expect(() => {
      transcriptHandler({
        text: "late transcript",
        isFinal: true,
        durationMs: 500,
        confidence: 0.9,
      });
    }).not.toThrow();

    expect(onTranscriptEvent).not.toHaveBeenCalled();
  });

  it("closes a session after the inactivity timeout elapses", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    let currentTime = 0;
    const manager = new TranscriptionManager({
      mode: "per-participant",
      createSession,
      inactivityTimeoutMs: 5000,
      meetingStartedAtMs: 0,
      onTranscriptEvent: vi.fn(),
      now: () => currentTime,
    });

    manager.handleAudioChunk("p1", Buffer.from([1]), 100);
    currentTime = 6000;
    manager.checkInactivity(currentTime);

    expect(s1.finish).toHaveBeenCalled();
  });
});

describe("TranscriptionManager (diarized mode)", () => {
  it("resolves participant identity from the active speaker timeline", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "diarized",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent,
      now: () => 0,
    });

    manager.handleActiveSpeaker("p1", 0);
    manager.handleAudioChunk("mixed", Buffer.from([1]), 100);

    s1.handlers.transcript({
      text: "hi",
      isFinal: true,
      durationMs: 100,
      confidence: 0.8,
      speakerLabel: "0",
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: "p1", speakerName: "p1" })
    );
  });

  it("falls back to a synthetic speaker id when no active-speaker window matches", () => {
    const s1 = makeFakeSession();
    const createSession = vi.fn(() => s1.connection);
    const onTranscriptEvent = vi.fn();
    const manager = new TranscriptionManager({
      mode: "diarized",
      createSession,
      inactivityTimeoutMs: 60_000,
      meetingStartedAtMs: 0,
      onTranscriptEvent,
      now: () => 0,
    });

    manager.handleAudioChunk("mixed", Buffer.from([1]), 100);
    s1.handlers.transcript({
      text: "hi",
      isFinal: true,
      durationMs: 100,
      confidence: 0.8,
      speakerLabel: "3",
    });

    expect(onTranscriptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: "speaker-3", speakerName: "speaker-3" })
    );
  });
});
