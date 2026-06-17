import type { RetryPolicy } from './retry-policy';

/**
 * Serialization-lane dispatcher seam. Processor code calls `runTask(lane, fn, policy)`
 * and never sees the concrete engine. Tasks sharing a `lane` run sequentially (FIFO);
 * tasks on different lanes run concurrently — replicating TanStack query-core mutation
 * `scope` semantics (see @tanstack/query-core MutationCache.canRun/runNext).
 *
 * The base ships NO concrete runner: variant A injects an in-memory `KeyedQueue`,
 * variant B injects a patched query-core `MutationObserver`-scope runner. Both must
 * honor `policy` (retry classification + backoff) and query-core's failureCount
 * semantics: call `policy.shouldRetry(failureCount, error)` with the current count
 * (0 on the first failure), then increment after the call.
 *
 * Implementations MUST support re-entrant enqueueing: a running task may call
 * `runTask` again on its OWN lane (e.g. a failed initiate enqueues a fail on the
 * same lane); the new task queues behind the current one and the current task
 * completes without blocking on it. A runner that awaits the nested task inline
 * would deadlock.
 */
export type TaskRunner = {
  runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T>;
};

export type { RetryPolicy } from './retry-policy';
