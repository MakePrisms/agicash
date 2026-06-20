import { MutationObserver, type QueryClient } from '@tanstack/query-core';
import {
  type RetryPolicy,
  defaultRetryPolicy,
  subscriptionRetryPolicy,
} from '../tasks/retry-policy';
import type { TaskRunner } from '../tasks/task-runner';

type Task = () => Promise<unknown>;

/**
 * Variant-B's {@link TaskRunner}: lanes are query-core mutation `scope` ids (via
 * the dynamic-scope patch in `patches/@tanstack%2Fquery-core@5.90.20.patch`), so
 * FIFO-per-lane + cross-lane concurrency + re-entrant drain come for free from
 * `MutationCache.canRun`/`runNext`: a same-scope second `mutate()` parks via the
 * retryer's `pause()` and is continued by the running task's `finally → runNext`,
 * so a task may enqueue on its OWN lane without deadlock (we must NOT inline-await
 * the nested enqueue).
 *
 * `retry`/`retryDelay` are MutationObserverOptions, NOT MutateOptions (which only
 * carry `scope`), so we keep ONE observer per distinct RetryPolicy (the SDK has
 * exactly two singletons) plus a no-retry observer for the no-policy path, and
 * pick by the policy arg; the lane rides per `mutate()` call.
 */
export function createMutationRunner(client: QueryClient): TaskRunner {
  const observerFor = (
    policy: RetryPolicy,
  ): MutationObserver<unknown, Error, Task> =>
    new MutationObserver<unknown, Error, Task>(client, {
      mutationFn: (task) => task(),
      networkMode: 'always',
      retry: (failureCount, error) => policy.shouldRetry(failureCount, error),
      retryDelay: (failureCount) => policy.retryDelay(failureCount),
    });

  const defaultObserver = observerFor(defaultRetryPolicy);
  const subscriptionObserver = observerFor(subscriptionRetryPolicy);
  const noRetryObserver = new MutationObserver<unknown, Error, Task>(client, {
    mutationFn: (task) => task(),
    networkMode: 'always',
    retry: false,
  });

  const observerFromPolicy = (
    policy?: RetryPolicy,
  ): MutationObserver<unknown, Error, Task> => {
    if (!policy) return noRetryObserver;
    if (policy === subscriptionRetryPolicy) return subscriptionObserver;
    if (policy === defaultRetryPolicy) return defaultObserver;
    return observerFor(policy);
  };

  return {
    runTask<T>(
      lane: string,
      fn: () => Promise<T>,
      policy?: RetryPolicy,
    ): Promise<T> {
      const observer = observerFromPolicy(policy);
      return observer.mutate(fn as Task, { scope: { id: lane } }) as Promise<T>;
    },
  };
}
