export interface DecisionCandidate {
  text: string;
  speakerName: string;
  confidence: number;
  topics: string[];
}

export interface TopicMention {
  label: string;
}

export interface ExtractionResult {
  decisions: DecisionCandidate[];
  topics: TopicMention[];
}

export interface ParticipantMention {
  participantId: string;
  speakerName: string;
}

export interface FormattedTranscript {
  promptText: string;
  participants: ParticipantMention[];
}
