import type { AnthropicExtractionClientLike } from "./decisionExtractor.types";
import type { ExtractionResult } from "./knowledgeGraph.types";

export class DecisionExtractor {
  constructor(private readonly client: AnthropicExtractionClientLike) {}

  async extract(transcriptText: string): Promise<ExtractionResult> {
    if (!transcriptText.trim()) {
      return { decisions: [], topics: [] };
    }
    return this.client.extract(transcriptText);
  }
}
