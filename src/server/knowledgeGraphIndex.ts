import "dotenv/config";
import { KnowledgeGraphWorker } from "../knowledgeGraph/knowledgeGraphWorker";
import { GraphBuildStore } from "../knowledgeGraph/graphBuildStore";
import { TranscriptFetcher } from "../knowledgeGraph/transcriptFetcher";
import { DecisionExtractor } from "../knowledgeGraph/decisionExtractor";
import { createRealAnthropicExtractionClient } from "../knowledgeGraph/realAnthropicExtractionClient";
import { GraphWriter } from "../knowledgeGraph/graphWriter";

async function startKnowledgeGraphWorker(): Promise<void> {
  const worker = new KnowledgeGraphWorker({
    buildStore: new GraphBuildStore(),
    fetcher: new TranscriptFetcher(),
    extractor: new DecisionExtractor(
      createRealAnthropicExtractionClient(process.env.ANTHROPIC_API_KEY!)
    ),
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
