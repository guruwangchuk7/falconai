import type { DbHandle } from '@falcon/db';
import type { LlmProviders } from '@falcon/llm';

/** Shared dependency bundle for core operations (injectable for tests). */
export interface CoreDeps {
  db: DbHandle;
  llm: LlmProviders;
}
