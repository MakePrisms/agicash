import type { Query } from '@agicash/wallet-sdk';
/**
 * useQ — bridge a Query<T> to React's useSyncExternalStore.
 *
 * Reads the query's snapshot synchronously (useSyncExternalStore contract),
 * subscribes via the query's subscribe() for change notifications, and
 * suspends on pending by throwing the deduped toPromise() promise.
 *
 * No react-query / TanStack Query import — only React + the Query<T> contract.
 */
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a `Query<T>` inside a React component.
 *
 * - Suspends (throws the deduped promise) while `status === 'pending'`.
 * - Re-throws `error` while `status === 'error'` (to be caught by an ErrorBoundary).
 * - Returns `data` once `status === 'success'`.
 *
 * The `q` reference must be stable (memoized by the domain implementation) —
 * each new `q` reference causes useSyncExternalStore to re-subscribe.
 *
 * @param q - the Query<T> returned by a domain observable-fetch method.
 * @returns the resolved data `T`.
 */
export function useQ<T>(q: Query<T>): T {
  // Bridge subscribe(onData, onError) to useSyncExternalStore's no-arg change signal.
  // Both data and error changes call the same cb so React re-renders and we can
  // re-read the snapshot to decide suspend/throw/return.
  const subscribe = useCallback((cb: () => void) => q.subscribe(cb, cb), [q]);
  const s = useSyncExternalStore(subscribe, q.getSnapshot);

  // While pending: throw the deduped promise. TanStack's fetchQuery deduplicates
  // in-flight requests so this promise is the same object for all concurrent
  // callers — Suspense sees a single pending boundary, not N.
  if (s.status === 'pending') {
    throw q.toPromise();
  }

  if (s.status === 'error') {
    throw s.error;
  }

  // status === 'success': data is defined.
  return s.data as T;
}
