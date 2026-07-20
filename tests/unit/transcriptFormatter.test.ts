import { describe, it, expect } from "vitest";
import { formatTranscriptForExtraction } from "../../src/knowledgeGraph/transcriptFormatter";

describe("formatTranscriptForExtraction", () => {
  it("returns empty output for no rows", () => {
    const result = formatTranscriptForExtraction([]);
    expect(result).toEqual({ promptText: "", participants: [] });
  });

  it("formats each row as [startTs] speakerName: text, joined by newlines", () => {
    const result = formatTranscriptForExtraction([
      { participantId: "p1", speakerName: "Alex", text: "Let's use Postgres.", startTs: 0 },
      { participantId: "p2", speakerName: "Sam", text: "Agreed.", startTs: 500 },
    ]);
    expect(result.promptText).toBe(
      "[0] Alex: Let's use Postgres.\n[500] Sam: Agreed."
    );
  });

  it("dedupes participants by participantId, keeping the first speakerName seen", () => {
    const result = formatTranscriptForExtraction([
      { participantId: "p1", speakerName: "Alex", text: "hi", startTs: 0 },
      { participantId: "p2", speakerName: "Sam", text: "hi", startTs: 100 },
      { participantId: "p1", speakerName: "Alex", text: "again", startTs: 200 },
    ]);
    expect(result.participants).toEqual([
      { participantId: "p1", speakerName: "Alex" },
      { participantId: "p2", speakerName: "Sam" },
    ]);
  });
});
