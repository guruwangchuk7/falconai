export interface DeepgramTranscriptPayload {
  text: string;
  isFinal: boolean;
  durationMs: number; // duration of this utterance segment; Deepgram's own start/duration
                       // are relative to when its connection opened, not the meeting timeline,
                       // so TranscriptionManager derives meeting-relative startTs/endTs itself
  confidence: number;
  speakerLabel?: string;
}

export interface DeepgramLiveConnectionLike {
  onTranscript(cb: (payload: DeepgramTranscriptPayload) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
  send(buffer: Buffer): void;
  finish(): void;
}
