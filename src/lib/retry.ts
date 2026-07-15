export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < config.retries) {
        await sleep(config.baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
