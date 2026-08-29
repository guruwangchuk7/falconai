import { answerQuestion, type CoreDeps } from '@falcon/core';
import type { AnswerCase } from './answer-fixture.js';

export interface AnswerEvalResult {
  question: string;
  expect: AnswerCase['expect'];
  got: 'grounded' | 'no_grounded_answer';
  pass: boolean;
  claims: number;
  detail: string;
}

/**
 * Run the answer-grounding golden set against the real answer path (real retrieval + LLM). A case
 * passes when the status matches the expected outcome AND, for a grounded answer, every rendered
 * claim carries ≥1 citation (the grounding invariant — no uncited claim may ship).
 */
export async function runAnswerEval(
  deps: CoreDeps,
  workspaceId: string,
  userId: string,
  cases: AnswerCase[],
): Promise<{ results: AnswerEvalResult[]; passRate: number }> {
  const results: AnswerEvalResult[] = [];
  for (const c of cases) {
    const a = await answerQuestion(deps, { workspaceId, requesterUserId: userId, question: c.question });
    const allClaimsCited = a.claims.length > 0 && a.claims.every((cl) => cl.citations.length > 0);
    const statusOk = a.status === c.expect;
    const groundingOk = c.expect === 'grounded' ? allClaimsCited : a.claims.length === 0;
    const pass = statusOk && groundingOk;
    results.push({
      question: c.question,
      expect: c.expect,
      got: a.status,
      pass,
      claims: a.claims.length,
      detail: pass ? 'ok' : !statusOk ? `expected ${c.expect}, got ${a.status}` : 'grounding invariant failed',
    });
  }
  const passRate = results.filter((r) => r.pass).length / results.length;
  return { results, passRate };
}
