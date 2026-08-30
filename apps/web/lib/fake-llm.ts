import { EMBEDDING_DIM, EMBEDDING_MODEL, EMBEDDING_VERSION, type LlmProviders } from '@falcon/llm';

/**
 * Deterministic, offline LLM providers for local dev + the authed e2e (T028) — NO API keys, no
 * network. Reached only via the `FALCON_FAKE_LLM` non-prod seam in deps.ts. It still produces a
 * GROUNDED, cited answer (a claim citing retrieved candidate #1), so it exercises the real
 * verify-then-drop grounding gate rather than bypassing it. Embeddings are a constant vector so a
 * chunk seeded with the same vector is always retrieved (cosine distance 0).
 */
const GROUNDED_ANSWER = JSON.stringify({
  claims: [{ text: 'You implemented the GitHub auth callback.', citations: [1] }],
});

export function fakeLlmProviders(): LlmProviders {
  const constantVector = () => new Array<number>(EMBEDDING_DIM).fill(0.1);
  return {
    chat: {
      model: 'fake-offline',
      complete: async () => ({ text: GROUNDED_ANSWER, usage: { inputTokens: 0, outputTokens: 0 } }),
    },
    embeddings: {
      model: EMBEDDING_MODEL,
      version: EMBEDDING_VERSION,
      dim: EMBEDDING_DIM,
      embed: async (texts: string[]) => texts.map(constantVector),
    },
    rerank: {
      model: 'fake-offline',
      rerank: async (_query: string, docs: string[], topK: number) =>
        docs.map((_, index) => ({ index, score: 1 - index * 0.01 })).slice(0, topK),
    },
  };
}
