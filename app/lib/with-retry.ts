import delay from '@agicash/sdk/lib/delay';

/**
 * Predicate that determines whether a function should be retried.
 * @param attemptIndex - Zero-based index of the retry attempt (0 after first failure, 1 after second, etc.).
 * @param error - The error thrown by the latest attempt.
 * @returns `true` to retry, `false` to stop and throw the error.
 */
type ShouldRetryFn = (attemptIndex: number, error: unknown) => boolean;

/**
 * Function that returns the delay in ms before the next retry attempt.
 * @param attemptIndex - Zero-based index of the retry attempt (0 after first failure, 1 after second, etc.).
 * @param error - The error thrown by the latest attempt.
 * @returns Delay in ms before the next retry.
 */
type RetryDelayFn = (attemptIndex: number, error: unknown) => number;

/** Options for {@link withRetry}. */
type WithRetryOptions<T> = {
  /** The async function to execute. */
  fn: () => Promise<T>;
  /**
   * Max number of retries, or a {@link ShouldRetryFn} predicate. Defaults to 3.
   * If predicate is used, attemptIndex starts at 0.
   */
  retry?: number | ShouldRetryFn;
  /**
   * Delay strategy between retries. Defaults to exponential backoff:
   * `min(500 * 2^attempt, 30000)` (500ms, 1s, 2s, ... capped at 30s).
   */
  retryDelay?: RetryDelayFn;
  /** AbortSignal to cancel pending retry delays. */
  signal?: AbortSignal;
};

const DEFAULT_BASE_DELAY = 500;
const DEFAULT_MAX_DELAY = 30_000;

function defaultRetryDelay(attemptIndex: number) {
  return Math.min(DEFAULT_BASE_DELAY * 2 ** attemptIndex, DEFAULT_MAX_DELAY);
}

/**
 * Executes an async function with automatic retries and exponential backoff.
 *
 * By default, waits `min(500 * 2^attempt, 30000)` ms between attempts
 * (500ms, 1s, 2s, 4s, ... capped at 30s).
 * Throws the error from the last failed attempt.
 *
 * @param options.fn - The async function to execute.
 * @param options.retry - Max number of retries (default 3), or a predicate
 *   `(attemptIndex, error) => boolean` for custom retry logic.
 * @param options.retryDelay - Custom delay function `(attemptIndex, error) => ms`.
 *   Overrides the default exponential backoff.
 * @param options.signal - AbortSignal to cancel pending retry delays.
 */
export async function withRetry<T>(options: WithRetryOptions<T>): Promise<T> {
  const { fn, retry = 3, retryDelay = defaultRetryDelay, signal } = options;

  const shouldRetry: ShouldRetryFn =
    typeof retry === 'function' ? retry : (count) => count < retry;

  let lastError: unknown;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!shouldRetry(attempt, error)) {
        break;
      }

      await delay(retryDelay(attempt, error), { signal });
    }
  }

  throw lastError;
}
