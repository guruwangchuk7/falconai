import { describe, it, expect, vi } from "vitest";
import { DecisionExtractor } from "../../src/knowledgeGraph/decisionExtractor";
import type { ExtractionResult } from "../../src/knowledgeGraph/knowledgeGraph.types";

describe("DecisionExtractor", () => {
  it("delegates to the client and returns its result", async () => {
    const extractionResult: ExtractionResult = {
      decisions: [{ text: "Use Postgres.", speakerName: "Alex", confidence: 0.9, topics: ["graph store"] }],
      topics: [{ label: "graph store" }],
    };
    const client = { extract: vi.fn().mockResolvedValue(extractionResult) };
    const extractor = new DecisionExtractor(client);

    const result = await extractor.extract("[0] Alex: Let's use Postgres.");

    expect(client.extract).toHaveBeenCalledWith("[0] Alex: Let's use Postgres.");
    expect(result).toEqual(extractionResult);
  });

  it("short-circuits to an empty result for a blank transcript without calling the client", async () => {
    const client = { extract: vi.fn() };
    const extractor = new DecisionExtractor(client);

    const result = await extractor.extract("   ");

    expect(result).toEqual({ decisions: [], topics: [] });
    expect(client.extract).not.toHaveBeenCalled();
  });
});
