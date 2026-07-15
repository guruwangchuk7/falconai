export type STTProvider = "deepgram" | "assemblyai" | "whisper";

export interface TranscriptEvent {
  version: 1;
  utteranceId: string;
  meetingId: string;
  participantId: string;
  speakerName: string;
  text: string;
  isFinal: boolean;
  startTs: number;
  endTs: number;
  confidence: number;
  source: STTProvider;
  sequenceNumber: number;
}

export interface Participant {
  participantId: string;
  displayName: string;
}

export interface MeetingLifecycleEvent {
  type: "meeting_lifecycle";
  meetingId: string;
  status: "started" | "ended" | "ended_error";
  timestamp: number;
  participants?: Participant[];
}
