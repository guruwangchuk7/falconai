import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, llmEnv } from '@falcon/config';

/**
 * Thin, cross-vendor provider interfaces (constitution V, OV-11, PRD §12.8). Models are PINNED
 * (never "-latest"); every chat generation is logged with its inputs (Langfuse) so a model swap
 * is a canary against the eval, not a surprise. A second vendor implements the same interface.
 */

// PINNED model ids — an upgrade is a code change gated on the §12.7 eval.
export const DIGEST_MODEL = 'claude-haiku-4-5-20251001';
export const EMBEDDING_MODEL = 'voyage-code-4';
export const EMBEDDING_VERSION = 'voyage-code-4'; // Voyage encodes version in the model id
export const EMBEDDING_DIM = 1024 as const;
export const RERANK_MODEL = 'rerank-2.5';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface ChatProvider {
  readonly model: string;
  complete(input: { system: string; messages: ChatMessage[]; maxTokens: number; meta?: Record<string, unknown> }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dim: typeof EMBEDDING_DIM;
  embed(texts: string[], inputType?: 'document' | 'query'): Promise<number[][]>;
}

export interface RerankProvider {
  readonly model: string;
  rerank(query: string, docs: string[], topK: number): Promise<{ index: number; score: number }[]>;
}

// ---------- Langfuse (best-effort, non-blocking) ----------
async function logGeneration(payload: Record<string, unknown>): Promise<void> {
  const env = loadEnv(llmEnv);
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return;
  const host = env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com';
  const auth = Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString('base64');
  try {
    await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ batch: [{ type: 'generation-create', id: crypto.randomUUID(), timestamp: new Date().toISOString(), body: payload }] }),
    });
  } catch {
    /* logging must never break the request path */
  }
}

// ---------- Anthropic chat ----------
export class AnthropicChatProvider implements ChatProvider {
  readonly model = DIGEST_MODEL;
  private client: Anthropic;
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey }); }

  async complete(input: { system: string; messages: ChatMessage[]; maxTokens: number; meta?: Record<string, unknown> }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    void logGeneration({ name: 'digest', model: this.model, input: { system: input.system, messages: input.messages, ...input.meta }, output: text, usage: { input: usage.inputTokens, output: usage.outputTokens } });
    return { text, usage };
  }
}

// ---------- Voyage embeddings + rerank (REST) ----------
class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly model = EMBEDDING_MODEL;
  readonly version = EMBEDDING_VERSION;
  readonly dim = EMBEDDING_DIM;
  constructor(private apiKey: string) {}
  async embed(texts: string[], inputType: 'document' | 'query' = 'document'): Promise<number[][]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts, input_type: inputType, output_dimension: this.dim }),
    });
    if (!res.ok) throw new Error(`voyage embeddings failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

class VoyageRerankProvider implements RerankProvider {
  readonly model = RERANK_MODEL;
  constructor(private apiKey: string) {}
  async rerank(query: string, docs: string[], topK: number) {
    const res = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, query, documents: docs, top_k: topK }),
    });
    if (!res.ok) throw new Error(`voyage rerank failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { index: number; relevance_score: number }[] };
    return json.data.map((d) => ({ index: d.index, score: d.relevance_score }));
  }
}

export interface LlmProviders {
  chat: ChatProvider;
  embeddings: EmbeddingProvider;
  rerank: RerankProvider;
}

export function createLlmProviders(): LlmProviders {
  const env = loadEnv(llmEnv);
  return {
    chat: new AnthropicChatProvider(env.ANTHROPIC_API_KEY),
    embeddings: new VoyageEmbeddingProvider(env.VOYAGE_API_KEY),
    rerank: new VoyageRerankProvider(env.VOYAGE_API_KEY),
  };
}
