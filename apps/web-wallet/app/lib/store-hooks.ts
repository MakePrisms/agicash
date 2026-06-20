import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { Store } from '@agicash/wallet-sdk/store';

/**
 * Snapshot of a store. `undefined` until the first load resolves (`[]`/`null`
 * are legitimately-empty loaded values, not loading sentinels).
 */
export function useStore<T>(store: Store<T>): T | undefined {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Suspense read: throws `store.toPromise()` until the first load resolves, so the
 * first wallet render suspends on the root `<Suspense>` instead of seeing an empty
 * store — the load-before-serve guarantee.
 *
 * @throws {Promise<T>} `store.toPromise()` while the store has not loaded yet.
 */
export function useStoreSuspense<T>(store: Store<T>): T {
  const value = useStore(store);
  if (value === undefined) throw store.toPromise();
  return value;
}

/**
 * Suspense read + memoized selection — re-renders only when the selected slice
 * changes. The selector runs against the loaded value; the result is kept
 * referentially stable across renders when `isEqual` (default `Object.is`)
 * reports no change, so consumers can `useMemo`/`useEffect` over it safely.
 *
 * @param selector Derives the slice from the loaded store value.
 * @param isEqual Compares the previous and next slice; defaults to `Object.is`.
 * @throws {Promise<T>} `store.toPromise()` while the store has not loaded yet.
 */
export function useStoreSelect<T, S>(
  store: Store<T>,
  selector: (value: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const value = useStore(store);
  const previous = useRef<{ selected: S } | null>(null);

  const selected = useMemo(() => {
    if (value === undefined) return undefined;
    const next = selector(value);
    if (previous.current && isEqual(previous.current.selected, next)) {
      return previous.current.selected;
    }
    previous.current = { selected: next };
    return next;
  }, [value, selector, isEqual]);

  if (value === undefined) throw store.toPromise();
  return selected as S;
}
