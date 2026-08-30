import { getDb } from '@falcon/db';
import { createLlmProviders, type LlmProviders } from '@falcon/llm';
import { createSecretStore, type SecretStore } from '@falcon/secrets';
import type { CoreDeps } from '@falcon/core';
import { fakeLlmProviders } from './fake-llm';

// Lazy singletons — no external connections at module import / build time.
let _deps: CoreDeps | undefined;
let _secrets: SecretStore | undefined;

/** Real providers, unless the non-prod `FALCON_FAKE_LLM` seam is set (local dev + the authed e2e,
 *  T028) — deterministic, offline, and NEVER honored in production regardless of the flag. */
function resolveLlm(): LlmProviders {
  if (process.env.FALCON_FAKE_LLM === '1' && process.env.NODE_ENV !== 'production') {
    return fakeLlmProviders();
  }
  return createLlmProviders();
}

export function deps(): CoreDeps {
  return (_deps ??= { db: getDb(), llm: resolveLlm() });
}
export function secrets(): SecretStore {
  return (_secrets ??= createSecretStore());
}
