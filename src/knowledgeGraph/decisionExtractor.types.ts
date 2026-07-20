import type { ExtractionResult } from "./knowledgeGraph.types";

export interface AnthropicExtractionClientLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}
