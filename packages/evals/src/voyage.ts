/** Minimal direct Voyage embeddings client so the bake-off can request a SPECIFIC model id
 *  (the app's EmbeddingProvider is pinned to one model; the whole point here is to compare). */
export async function voyageEmbed(
  texts: string[],
  model: string,
  apiKey: string,
  inputType: 'document' | 'query' = 'document',
): Promise<number[][]> {
  const r = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: texts, model, input_type: inputType }),
  });
  if (!r.ok) throw new Error(`voyage embed failed (${model}): ${r.status} ${await r.text()}`);
  const json = (await r.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}
