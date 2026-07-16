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
  maxBufferedChunks?: number;
  reconnect?: { retries: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
}

interface ActiveSession {
  session: SttSession;
  lastActivityMs: number;
  // Raw Zoom timestamp (same epoch as meetingStartedAtMs) of the most recent
  // audio chunk sent to this session — used to derive meeting-relative
  // startTs/endTs, since Deepgram's own start/duration are relative to when
  // its connection opened, not the meeting timeline.
  lastRawTimestampMs: number;
  bufferedChunks: Buffer[];
  reconnecting: boolean;
  // Persistent per-session count of consecutive connection failures. Only reset
  // to 0 on genuine proof of life (a real transcript result in handleResult), NOT
  // merely when a new session object is constructed -- for the real Deepgram client
  // SttSession.start never throws, so "a session object exists" proves nothing about
  // whether the connection actually works. This is the source of truth for backoff
  // escalation and the give-up condition.
  failureCount: number;
}

const DIARIZED_KEY = "__diarized__";
const DEFAULT_MAX_BUFFERED_CHUNKS = 250; // ~5s at 20ms/frame
const DEFAULT_RECONNECT = { retries: 5, baseDelayMs: 500 };

export class TranscriptionManager extends EventEmitter {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly activeSpeakerTimeline = new ActiveSpeakerTimeline();
  private readonly source: STTProvider;
  private readonly maxBufferedChunks: number;
  private readonly reconnectConfig: { retries: number; baseDelayMs: number };
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: TranscriptionManagerDeps) {
    super();
    this.source = deps.source ?? "deepgram";
    this.maxBufferedChunks = deps.maxBufferedChunks ?? DEFAULT_MAX_BUFFERED_CHUNKS;
    this.reconnectConfig = deps.reconnect ?? DEFAULT_RECONNECT;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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

    if (active.reconnecting) {
      this.bufferChunk(active, buffer);
      return;
    }
    active.session.send(buffer);
  }

  handleParticipantLeft(participantId: string): void {
    // In diarized mode, the session is shared across all participants and keyed by DIARIZED_KEY, not participantId.
    // A single participant leaving should not tear down the shared session — it lives until inactivity timeout or meeting end.
    if (this.deps.mode === "diarized") {
      return;
    }
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

  closeAll(): void {
    for (const [key, active] of this.sessions.entries()) {
      active.session.close();
      this.sessions.delete(key);
    }
  }

  private bufferChunk(active: ActiveSession, buffer: Buffer): void {
    active.bufferedChunks.push(buffer);
    if (active.bufferedChunks.length > this.maxBufferedChunks) {
      active.bufferedChunks.shift();
      console.warn("dropping buffered audio chunk: reconnect buffer full");
    }
  }

  // The single external entry point for a connection failure signalled by a
  // session's onError/onClose. Owns the reentrancy guard and reads the session's
  // own PERSISTENT failure count so that backoff escalates across repeated async
  // failures and the give-up condition is actually reachable -- the real Deepgram
  // client never throws synchronously, so it always fails via these callbacks.
  private onSessionFailure(key: string): void {
    const active = this.sessions.get(key);
    if (!active) return;
    // Reentrancy guard: onError and onClose can both fire for the same underlying
    // failure. Only the first should start a reconnect chain; a second concurrent
    // trigger for the same key must be a no-op so we never end up with two
    // independent chains racing to replace active.session.
    if (active.reconnecting) return;
    active.reconnecting = true;
    const attempt = active.failureCount;
    active.failureCount += 1;
    void this.beginReconnect(key, attempt);
  }

  private async beginReconnect(key: string, attempt: number): Promise<void> {
    const active = this.sessions.get(key);
    if (!active) return;

    if (attempt >= this.reconnectConfig.retries) {
      this.sessions.delete(key);
      return;
    }

    await this.sleep(this.reconnectConfig.baseDelayMs * 2 ** attempt);

    // Re-validate after the sleep: checkInactivity or handleParticipantLeft may
    // have removed (or replaced) this session's entry while we were asleep. If so,
    // this reconnect attempt is stale and must not resurrect a connection nobody
    // references anymore.
    if (this.sessions.get(key) !== active) {
      return;
    }

    try {
      const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
      const newSession = SttSession.start(connection, {
        onResult: (payload) => this.handleResult(key, payload),
        onError: () => this.onSessionFailure(key),
        onClose: () => this.onSessionFailure(key),
      });

      // Guard against the session being torn down/replaced during creation as well.
      if (this.sessions.get(key) !== active) {
        newSession.close();
        return;
      }

      const bufferedChunks = active.bufferedChunks;
      active.session = newSession;
      active.bufferedChunks = [];
      active.reconnecting = false;
      for (const chunk of bufferedChunks) {
        newSession.send(chunk);
      }
    } catch {
      await this.beginReconnect(key, attempt + 1);
    }
  }

  private openSession(key: string): ActiveSession {
    const connection = this.deps.createSession({ diarize: this.deps.mode === "diarized" });
    const session = SttSession.start(connection, {
      onResult: (payload) => this.handleResult(key, payload),
      onError: () => this.onSessionFailure(key),
      onClose: () => this.onSessionFailure(key),
    });
    const active: ActiveSession = {
      session,
      lastActivityMs: this.deps.now(),
      lastRawTimestampMs: this.deps.meetingStartedAtMs,
      bufferedChunks: [],
      reconnecting: false,
      failureCount: 0,
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
    // Late transcript arriving after session was already torn down — discard to avoid negative timestamp.
    if (!active) {
      return;
    }
    // Receiving a real transcript is proof the connection is genuinely alive, so
    // reset the persistent failure count that drives reconnect backoff/give-up.
    active.failureCount = 0;
    const endTsRaw = active.lastRawTimestampMs;
    // Clamp the utterance start to never precede the meeting start: if someone is
    // already talking as the bot joins, the first final transcript's durationMs can
    // exceed the elapsed meeting time, making startTsRaw < meetingStartedAtMs and
    // causing normalizeTimestamp to throw. Clamping yields startTs = 0, the best
    // available approximation for an utterance that began before the meeting.
    const startTsRaw = Math.max(this.deps.meetingStartedAtMs, endTsRaw - payload.durationMs);
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
