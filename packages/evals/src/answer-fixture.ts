/**
 * Answer-grounding golden set (Constitution V, spec 002 T002). Curated from the FalconAI repo's
 * real synced work: questions with a KNOWN correct grounding outcome. "grounded" = Falcon should
 * answer with ≥1 cited claim; "no_grounded_answer" = Falcon should abstain (no such work).
 *
 * This is the pre-registered bar: prompt/model changes are measured against it before shipping.
 * Extend with real dogfood questions as they accumulate (they're logged as query_event rows).
 */

export interface AnswerCase {
  question: string;
  expect: 'grounded' | 'no_grounded_answer';
  why: string;
}

export const ANSWER_GOLDEN: AnswerCase[] = [
  // --- Should be grounded (the work exists in the synced repo) ---
  { question: 'What did I do for authentication?', expect: 'grounded', why: 'Auth.js GitHub provider + callbacks' },
  { question: 'What happened with the Jira connect flow?', expect: 'grounded', why: 'commit 023d4244a0 (T037)' },
  { question: 'What did I do for the Linear integration?', expect: 'grounded', why: 'Linear OAuth connect flow' },
  { question: 'What CI or GitHub Actions setup exists?', expect: 'grounded', why: 'ci: typecheck/integration/no-token-in-db' },
  { question: 'What was done for observability?', expect: 'grounded', why: 'Sentry + PostHog wiring (T014)' },
  { question: 'What did I do about rate limiting?', expect: 'grounded', why: 'Redis rate limiting on webhooks' },

  // --- Should abstain (no such work — must NOT fabricate) ---
  { question: 'What did I do on the billing system?', expect: 'no_grounded_answer', why: 'no billing work synced' },
  { question: 'Did I build a mobile app?', expect: 'no_grounded_answer', why: 'no mobile work' },
  { question: 'What did I do with Kubernetes?', expect: 'no_grounded_answer', why: 'no k8s work' },
];

/** Pass bar: this golden set is high-confidence, so require a strong pass rate. One LLM flake is
 *  tolerated; two is a regression worth investigating before shipping a prompt/model change. */
export const ANSWER_EVAL_BAR = 0.85;
