/** Pure ranking + recall metrics — no I/O, unit-testable, the core of the bake-off (research D6). */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Indices of `docs` sorted by descending cosine similarity to `query`. */
export function rankByCosine(query: number[], docs: number[][]): number[] {
  return docs
    .map((d, i) => ({ i, s: cosine(query, d) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

/** recall@k = (relevant ids found in the top-k retrieved) / (total relevant). Empty relevant → 1. */
export function recallAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (relevantIds.length === 0) return 1;
  const top = new Set(retrievedIds.slice(0, k));
  const hit = relevantIds.filter((id) => top.has(id)).length;
  return hit / relevantIds.length;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
