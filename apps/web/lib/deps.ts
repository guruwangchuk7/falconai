import { getDb } from '@falcon/db';
import { createLlmProviders } from '@falcon/llm';
import { createSecretStore, type SecretStore } from '@falcon/secrets';
import type { CoreDeps } from '@falcon/core';

// Lazy singletons — no external connections at module import / build time.
let _deps: CoreDeps | undefined;
let _secrets: SecretStore | undefined;

export function deps(): CoreDeps {
  return (_deps ??= { db: getDb(), llm: createLlmProviders() });
}
export function secrets(): SecretStore {
  return (_secrets ??= createSecretStore());
}
