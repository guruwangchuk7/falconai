import type { FormattedTranscript, ParticipantMention } from "./knowledgeGraph.types";

export interface TranscriptEventRow {
  participantId: string;
  speakerName: string;
  text: string;
  startTs: number;
}

export function formatTranscriptForExtraction(rows: TranscriptEventRow[]): FormattedTranscript {
  const promptText = rows.map((row) => `[${row.startTs}] ${row.speakerName}: ${row.text}`).join("\n");

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.participantId)) {
      seen.set(row.participantId, row.speakerName);
    }
  }
  const participants: ParticipantMention[] = [...seen.entries()].map(
    ([participantId, speakerName]) => ({ participantId, speakerName })
  );

  return { promptText, participants };
}
