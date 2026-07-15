import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SttSession } from "./sttSession";
import { ActiveSpeakerTimeline } from "./activeSpeakerTimeline";
import { normalizeTimestamp } from "../lib/timestampNormalizer";
import type { DeepgramLiveConnectionLike } from "./deepgramLiveConnection.types";
import type { STTProvider, TranscriptEvent } from "../types/transcriptEvent";

type PartialTranscriptEvent = Omit<TranscriptEvent, "sequenceNumber" | "meetingId">;

export interface TranscriptionManagerDeps {
  mode: "per-participant" | "diarized";
  createSession: (opts: { diarize: boolean }) => DeepgramLiveConnectionLike;
  inactivityTimeoutMs: number;
  meetingStartedAtMs: number;
  onTranscriptEvent: (event: PartialTranscriptEvent) => void;
  now: () => number;
  source?: STTProvider;
}

interface ActiveSession {
  session: SttSession;
  lastActivityMs: number;
  // Raw Zoom timestamp (same epoch as meetingStartedAtMs) of the most recent
  // audio chunk sent to this session — used to derive meeting-relative
  // startTs/endTs, since Deepgram's own start/duration are relative to when
  // its connection opened, not the meeting timeline.
  lastRawTimestampMs: number;
}

const DIARIZED_KEY = "__diarized__";

export class TranscriptionManager extends EventEmitter {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly activeSpeakerTimeline = new ActiveSpeakerTimeline();
  private readonly source: STTProvider;

  constructor(private readonly deps: TranscriptionManagerDeps) {
    super();
    this.source = deps.source ?? "deepgram";
  }

  handleActiveSpeaker(participantId: string, timestamp: number): void {
    this.activeSpeakerTimeline.recordActiveSpeaker(
      participantId,
      normalizeTimestamp(timestamp, this.deps.meetingStartedAtMs)
    );
  }

  handleAudioChunk(participantId: string, buffer: Buffer, timestamp: number): void {
    const key = this.deps.mode === "diarized" ? DIARIZED_KEY : participantId;
    let active = this.sessions.get(key);
    if (!active) {
      active = this.openSession(key);
    }
    active.lastActivityMs = this.deps.now();
    active.lastRawTimestampMs = timestamp;
    active.session.send(buffer);
  }

  handleParticipantLeft(participantId: string): void {
    const active = this.sessions.get(participantId);
    if (active) {
      active.session.close();
      this.sessions.delete(participantId);
    }
  }

  checkInactivity(now: number): void {
    for (const [key, active] of this.sessions.entries()) {
      if (now - active.lastActivityMs > this.deps.inactivityTimeoutMs) {
        active.session.close();
        this.sessions.delete(key);
      }
    }
  }

  private openSession(key: string): ActiveSession {
    const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
    const session = SttSession.start(connection, {
      onResult: (payload) => this.handleResult(key, payload),
      onError: () => {
        /* handled by reconnect logic in Task 11 */
      },
      onClose: () => {
        /* handled by reconnect logic in Task 11 */
      },
    });
    const active: ActiveSession = {
      session,
      lastActivityMs: this.deps.now(),
      lastRawTimestampMs: this.deps.meetingStartedAtMs,
    };
    this.sessions.set(key, active);
    return active;
  }

  private handleResult(
    key: string,
    payload: {
      text: string;
      isFinal: boolean;
      durationMs: number;
      confidence: number;
      speakerLabel?: string;
    }
  ): void {
    const active = this.sessions.get(key);
    const endTsRaw = active?.lastRawTimestampMs ?? this.deps.meetingStartedAtMs;
    const startTsRaw = endTsRaw - payload.durationMs;
    const startTs = normalizeTimestamp(startTsRaw, this.deps.meetingStartedAtMs);
    const endTs = normalizeTimestamp(endTsRaw, this.deps.meetingStartedAtMs);

    const participantId =
      this.deps.mode === "diarized"
        ? this.activeSpeakerTimeline.resolveParticipant(startTs, endTs) ??
          `speaker-${payload.speakerLabel ?? "unknown"}`
        : key;

    this.deps.onTranscriptEvent({
      version: 1,
      utteranceId: randomUUID(),
      participantId,
      speakerName: participantId,
      text: payload.text,
      isFinal: payload.isFinal,
      startTs,
      endTs,
      confidence: payload.confidence,
      source: this.source,
    });
  }
}
