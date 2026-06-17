import { MintOperationError } from '@cashu/cashu-ts';
import { ConcurrencyError, DomainError } from '../../errors';

/**
 * Retry classification + backoff applied by the concrete `TaskRunner`.
 * - `shouldRetry(failureCount, error)` → true = retry, false = give up.
 * - `retryDelay(failureCount)` → ms before the next attempt.
 */
export type RetryPolicy = {
  shouldRetry: (failureCount: number, error: unknown) => boolean;
  retryDelay: (failureCount: number) => number;
};

/** query-core's default mutation backoff: 1s, 2s, 4s, … capped at 30s. */
export const exponentialBackoff = (failureCount: number): number =>
  Math.min(1000 * 2 ** failureCount, 30000);

/**
 * Unified classification: ConcurrencyError → always retry; DomainError /
 * MintOperationError → never; everything else (transient) → bounded by `maxAttempts`.
 * `maxAttempts` mirrors the app's `failureCount < N` predicates.
 */
export const classifyRetry =
  (maxAttempts: number) =>
  (failureCount: number, error: unknown): boolean => {
    if (error instanceof ConcurrencyError) return true;
    if (error instanceof DomainError) return false;
    if (error instanceof MintOperationError) return false;
    return failureCount < maxAttempts;
  };

/** Bounded-3 policy for processor state transitions. */
export const defaultRetryPolicy: RetryPolicy = {
  shouldRetry: classifyRetry(3),
  retryDelay: exponentialBackoff,
};

/** Bounded-5 policy for subscription setup (matches the app's `retry: 5`). */
export const subscriptionRetryPolicy: RetryPolicy = {
  shouldRetry: classifyRetry(5),
  retryDelay: exponentialBackoff,
};
