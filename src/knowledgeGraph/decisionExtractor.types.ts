import type { ExtractionResult } from "./knowledgeGraph.types";

export interface ExtractionClientLike {
  extract(transcriptText: string): Promise<ExtractionResult>;
}
