import { EMBEDDING_DIM, EMBEDDING_MODEL, EMBEDDING_VERSION, type EmbeddingProvider, type LlmProviders } from '@falcon/llm';

/**
 * Deterministic, offline embeddings for integration tests. Tokens are hashed into a 1024-dim
 * bag-of-words vector and normalized, so text sharing more tokens with the query ranks higher —
 * enough to exercise retrieve()/index end to end WITHOUT hitting Voyage (CI has no API keys).
 * The model/version stamps match the real constants, which is what retrieve() filters on.
 */
export function fakeEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    v[h % EMBEDDING_DIM]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export const fakeEmbeddings: EmbeddingProvider = {
  model: EMBEDDING_MODEL,
  version: EMBEDDING_VERSION,
  dim: EMBEDDING_DIM,
  embed: async (texts) => texts.map(fakeEmbed),
};

export const fakeLlm: LlmProviders = {
  embeddings: fakeEmbeddings,
  chat: {
    model: 'fake',
    complete: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 } }),
  },
  rerank: {
    model: 'fake',
    rerank: async (_query, docs, topK) => docs.map((_, index) => ({ index, score: 0 })).slice(0, topK),
  },
};
