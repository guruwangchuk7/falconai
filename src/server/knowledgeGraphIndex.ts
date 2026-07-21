import "dotenv/config";
import { KnowledgeGraphWorker } from "../knowledgeGraph/knowledgeGraphWorker";
import { GraphBuildStore } from "../knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../knowledgeGraph/transcriptFetcher";
import { DecisionExtractor } from "../knowledgeGraph/decisionExtractor";
import { createRealAnthropicExtractionClient } from "../knowledgeGraph/realAnthropicExtractionClient";
import { createRealGeminiExtractionClient } from "../knowledgeGraph/realGeminiExtractionClient";
import { GraphWriter } from "../knowledgeGraph/graphWriter";
import type { ExtractionClientLike } from "../knowledgeGraph/decisionExtractor.types";

function createExtractionClient(): ExtractionClientLike {
  const provider = process.env.KG_EXTRACTION_PROVIDER;
  if (provider === "gemini") {
    return createRealGeminiExtractionClient(process.env.GEMINI_API_KEY!);
  }
  if (provider === "anthropic") {
    return createRealAnthropicExtractionClient(process.env.ANTHROPIC_API_KEY!);
  }
  throw new Error(
    `KG_EXTRACTION_PROVIDER must be "gemini" or "anthropic", got: ${JSON.stringify(provider)}`
  );
}

async function startKnowledgeGraphWorker(): Promise<void> {
  const worker = new KnowledgeGraphWorker({
    buildStore: new GraphBuildStore(),
    fetcher: new TranscriptFetcher(),
    extractor: new DecisionExtractor(createExtractionClient()),
    writer: new GraphWriter(),
    onAlert: (message, err) => console.error(message, err),
    pollIntervalMs: Number(process.env.KG_POLL_INTERVAL_MS ?? 5000),
  });

  console.log("Knowledge Graph worker started, polling for ended meetings...");
  await worker.start();
}

startKnowledgeGraphWorker().catch((err) => {
  console.error("failed to start Knowledge Graph worker", err);
  process.exit(1);
});
