import { DOCS, QUERIES } from './fixture.js';
import { mean, rankByCosine, recallAtK } from './recall.js';
import { voyageEmbed } from './voyage.js';

export { cosine, mean, rankByCosine, recallAtK } from './recall.js';
export { voyageEmbed } from './voyage.js';
export { DOCS, QUERIES, type EvalDoc, type EvalQuery } from './fixture.js';
export { ANSWER_GOLDEN, ANSWER_EVAL_BAR, type AnswerCase } from './answer-fixture.js';
export { runAnswerEval, type AnswerEvalResult } from './answer-eval.js';
export {
  runDecisionCeiling, cosineDistance,
  CEILING_DECISIONS, CEILING_DISTRACTORS, CEILING_QUERIES,
  type CeilingRow, type CeilingReport,
} from './decision-ceiling.js';

/** Embedding models to compare (research D6: settle voyage-code-4 vs voyage-4-large). */
export const BAKEOFF_MODELS = ['voyage-code-4', 'voyage-4-large'] as const;
export const BAKEOFF_KS = [1, 3, 5] as const;

export type BakeoffResult = Record<string, Record<number, number>>;

/** Embed the fixture with each model, rank each query, and report mean recall@k per model. */
export async function runBakeoff(apiKey: string, models: readonly string[] = BAKEOFF_MODELS): Promise<BakeoffResult> {
  const out: BakeoffResult = {};
  for (const model of models) {
    const docVecs = await voyageEmbed(DOCS.map((d) => d.text), model, apiKey, 'document');
    const qVecs = await voyageEmbed(QUERIES.map((q) => q.query), model, apiKey, 'query');
    const perK = new Map<number, number[]>(BAKEOFF_KS.map((k) => [k, []]));
    QUERIES.forEach((q, qi) => {
      const rankedIds = rankByCosine(qVecs[qi]!, docVecs).map((i) => DOCS[i]!.id);
      for (const k of BAKEOFF_KS) perK.get(k)!.push(recallAtK(rankedIds, q.relevantIds, k));
    });
    out[model] = Object.fromEntries(BAKEOFF_KS.map((k) => [k, mean(perK.get(k)!)]));
  }
  return out;
}
