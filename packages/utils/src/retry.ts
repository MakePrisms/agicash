export type RetryWithBackoffOptions = {
  /** Retries after the initial attempt (so total attempts = `retries` + 1). */
  retries: number;
  /**
   * Stops the loop before the next attempt and interrupts any pending backoff
   * delay when aborted.
   */
  signal?: AbortSignal;
  /**
   * Backoff in ms before the retry that follows the 0-based `attempt`. Defaults
   * to {@link defaultRetryDelayMs}.
   */
  delayMs?: (attempt: number) => number;
  /** Invoked with each failed attempt's error (e.g. for logging). */
  onError?: (error: unknown, attempt: number) => void;
};

/** Exponential backoff capped at 30s: 1s, 2s, 4s, 8s, 16s, 30s, 30s, … */
export const defaultRetryDelayMs = (attempt: number): number =>
  Math.min(1000 * 2 ** attempt, 30_000);

/**
 * Retries an async function with exponential backoff until it resolves, the
 * retry budget is exhausted (throws the last error), or `signal` aborts.
 *
 * Unlike a query-core mutation the loop is cancellable: aborting stops it before
 * the next attempt and interrupts a pending backoff, so in-flight work (e.g. a
 * socket subscribe) is not re-attempted after the caller has torn down. Aborting
 * throws the signal's reason (or a generic abort error); callers that fire it
 * and forget can ignore the rejection.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  {
    retries,
    signal,
    delayMs = defaultRetryDelayMs,
    onError,
  }: RetryWithBackoffOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }
    try {
      return await fn();
    } catch (error) {
      onError?.(error, attempt);
      if (attempt >= retries) {
        throw error;
      }
      await delayWithAbort(delayMs(attempt), signal);
    }
  }
}

const delayWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
