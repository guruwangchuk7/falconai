import { getDb } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { ANSWER_GOLDEN, ANSWER_EVAL_BAR } from './answer-fixture.js';
import { runAnswerEval } from './answer-eval.js';

/**
 * Answer-grounding eval runner (Constitution V, spec 002 T027). Runs the golden set against the
 * real answer path for a given workspace/user. Exits non-zero if the pass rate is below the bar —
 * wire into CI as the gate before any prompt/model change to the answer path ships.
 *
 *   EVAL_WORKSPACE_ID=<ws> EVAL_USER_ID=<user> pnpm --filter @falcon/evals answer
 */
async function main() {
  const workspaceId = process.env.EVAL_WORKSPACE_ID;
  const userId = process.env.EVAL_USER_ID;
  if (!workspaceId || !userId) {
    console.error('Set EVAL_WORKSPACE_ID and EVAL_USER_ID (a workspace/user with synced work).');
    process.exit(2);
  }

  const deps = { db: getDb(), llm: createLlmProviders() };
  const { results, passRate } = await runAnswerEval(deps, workspaceId, userId, ANSWER_GOLDEN);

  console.log('\nAnswer-grounding eval\n' + '='.repeat(60));
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.expect.padEnd(18)}→ ${r.got.padEnd(18)}] ${r.question}${r.pass ? '' : '  — ' + r.detail}`);
  }
  console.log('='.repeat(60));
  console.log(`pass rate: ${(passRate * 100).toFixed(0)}%  (bar: ${(ANSWER_EVAL_BAR * 100).toFixed(0)}%)  —  ${passRate >= ANSWER_EVAL_BAR ? 'CLEARED' : 'BELOW BAR'}`);
  process.exit(passRate >= ANSWER_EVAL_BAR ? 0 : 1);
}

void main();
