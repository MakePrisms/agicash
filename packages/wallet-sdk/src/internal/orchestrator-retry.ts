/**
 * Orchestrator retry + verdict→error-model wiring — Slice 3 / PR5d.
 *
 * This is the framework-free replacement for the retry/error branching master's
 * `useProcess*Tasks` hooks got from React Query's `useMutation({ retry })`. It composes two
 * already-built pieces:
 *  - {@link classify} (§12, PR2) — the pure 4-bucket verdict (`transient` | `permanent` |
 *    `already-resolved` | `unhandled`);
 *  - {@link withRetry} (`app/lib/with-retry.ts`, lifted in `./lib-retry`) — exponential-backoff
 *    retry.
 *
 * The mapping (build plan §3 / contract §12):
 *
 * | verdict            | orchestrator action                                              |
 * | ------------------ | ---------------------------------------------------------------- |
 * | `transient`        | retry (up to `maxRetries`); if still failing → `ConcurrencyError` |
 * | `permanent`        | do NOT retry → surface as `DomainError`                           |
 * | `already-resolved` | do NOT retry → treat as a no-op (the desired end-state is reached)|
 * | `unhandled`        | do NOT retry → propagate the original error                      |
 *
 * GROUNDING. Master's hooks retry blindly up to 3× on most steps and gate ONLY on
 * `error instanceof MintOperationError` (→ stop + fail). This refines that binary using
 * `classify`: a mint rejection that is "already-spent / already-issued" is no longer a hard fail
 * (it is the success end-state, reconciled by the services' `wallet.restore`), and a
 * "proofs/outputs pending" rejection becomes retryable rather than fatal — matching the no-cache
 * analyses. The `maxRetries` default of 3 preserves master's `retry: 3`.
 *
 * @module
 */
import { type ErrorClass, classify } from '../classify';
import { ConcurrencyError, DomainError, SdkError } from '../errors';
import { withRetry } from './lib-retry';

/** The default retry budget for a transient step — matches master's hook `retry: 3`. */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * The resolved outcome of running an idempotent step through {@link runStep}: either the step's
 * value, or a signal that the work was already done (so the caller treats it as a no-op).
 */
export type StepOutcome<T> =
  | { kind: 'resolved'; value: T }
  | { kind: 'already-resolved' };

/**
 * Run an idempotent orchestrator step with retry + the verdict→error-model mapping.
 *
 * Retries ONLY while the error classifies `transient` (and the budget remains). A `permanent`
 * verdict is re-thrown as a {@link DomainError}; a `transient` budget-exhausted failure as a
 * {@link ConcurrencyError}; an `already-resolved` verdict resolves to `{ kind: 'already-resolved' }`
 * (the services' `wallet.restore` has reconciled local state); `unhandled` propagates the original
 * error unchanged.
 *
 * Mirrors the idempotency of the services it wraps: re-running a step that has already taken
 * effect is safe (the service no-ops on the terminal state, or the mint reports already-done →
 * `already-resolved`).
 *
 * @param fn - the async step (a service-primitive call).
 * @param options.maxRetries - transient-retry budget (default {@link DEFAULT_MAX_RETRIES}).
 * @param options.signal - optional abort signal (cancels pending retry delays).
 * @returns the step outcome.
 * @throws ConcurrencyError on transient exhaustion, DomainError on a permanent verdict, or the
 *   original error when `unhandled`.
 */
export async function runStep<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<StepOutcome<T>> {
  const { maxRetries = DEFAULT_MAX_RETRIES, signal } = options;

  try {
    const value = await withRetry({
      fn,
      // Retry only while the verdict stays `transient` and the budget remains.
      retry: (attemptIndex, error) =>
        attemptIndex < maxRetries && classify(error) === 'transient',
      signal,
    });
    return { kind: 'resolved', value };
  } catch (error) {
    return mapVerdictToOutcome<T>(error);
  }
}

/**
 * Map a thrown error's {@link classify} verdict onto the orchestrator's error model. Exposed
 * separately so callers that don't need the retry loop (or that catch outside `withRetry`) reuse
 * the SAME mapping.
 *
 * @param error - the thrown value from the failed step (post-retry).
 * @returns `{ kind: 'already-resolved' }` for an already-resolved verdict.
 * @throws ConcurrencyError (transient), DomainError (permanent), or the original error (unhandled).
 */
export function mapVerdictToOutcome<T>(error: unknown): StepOutcome<T> {
  const verdict: ErrorClass = classify(error);

  switch (verdict) {
    case 'already-resolved':
      // The desired end-state is already reached (e.g. proofs already spent / quote already
      // issued); the service's `wallet.restore` reconciled local state. No-op.
      return { kind: 'already-resolved' };
    case 'transient':
      // Survived the retry budget and is still transient — surface as the SDK's "stale, refetch +
      // retry" signal so the next processor sweep / kickoff re-attempts.
      throw asConcurrencyError(error);
    case 'permanent':
      // A deterministic rejection (the mint/peer will reject it identically) — surface to the user.
      throw asDomainError(error);
    default:
      // `unhandled` — propagate untouched so nothing is silently swallowed.
      throw error;
  }
}

/** Wrap a transient failure as a {@link ConcurrencyError} (preserving an existing one + the cause). */
function asConcurrencyError(error: unknown): ConcurrencyError {
  if (error instanceof ConcurrencyError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new ConcurrencyError(message);
  if (error instanceof Error) {
    wrapped.cause = error;
  }
  return wrapped;
}

/** Wrap a permanent failure as a {@link DomainError} (preserving an existing SDK error message). */
function asDomainError(error: unknown): DomainError {
  if (error instanceof SdkError) {
    // A DomainError/NotFoundError is already user-facing — keep its message.
    const wrapped = new DomainError(error.message);
    wrapped.cause = error;
    return wrapped;
  }
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new DomainError(message);
  if (error instanceof Error) {
    wrapped.cause = error;
  }
  return wrapped;
}
