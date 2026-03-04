export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function computeBackoffDelayMs(baseDelayMs: number, maxDelayMs: number, attempt: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(10, exp * 0.2));
  return Math.min(maxDelayMs, exp + jitter);
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= options.attempts;
      const shouldRetry = options.shouldRetry ? options.shouldRetry(error, attempt) : true;

      if (isLastAttempt || !shouldRetry) {
        break;
      }

      const delayMs = computeBackoffDelayMs(options.baseDelayMs, options.maxDelayMs, attempt);
      if (options.onRetry) {
        await options.onRetry(error, attempt, delayMs);
      }
      await wait(delayMs);
    }
  }

  throw lastError;
}
