import {
  type QueryClient,
  type QueryKey,
  QueryObserver,
} from '@tanstack/query-core';

/** The Variant-B reactive primitive (engine-neutral surface — no @tanstack types leak). */
export type Store<T> = {
  /** Sync snapshot; `undefined` = not yet loaded ([]/null = legitimately empty). Referentially stable between changes. */
  get(): T | undefined;
  /** Fires on every change; returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Resolves on first successful load (unconditional fetch). The load-before-serve seam. */
  toPromise(): Promise<T>;
  /** Synchronous version-gated write used by the fanout. */
  set(updater: T | ((prev: T | undefined) => T)): void;
};

/**
 * A resident store backed by a long-lived QueryObserver. A permanent no-op
 * subscription keeps the observer mounted so its cached result stays current on
 * `setQueryData` and is never GC'd while the SDK lives. `staleTime: Infinity`
 * (from the client defaults) means subscribe/fetch won't auto-refetch over a
 * fanout write; `toPromise()` (`fetchOptimistic`) forces the cold first load.
 */
export function createStore<T>(
  client: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
): Store<T> {
  const observer = new QueryObserver<T, Error, T, T, QueryKey>(client, {
    queryKey,
    queryFn,
  });
  // Keep mounted for the SDK's lifetime: structural sharing + change notifications.
  observer.subscribe(() => {});
  return {
    get: () => observer.getCurrentResult().data,
    subscribe: (cb) => observer.subscribe(() => cb()),
    toPromise: async () => {
      const result = await observer.fetchOptimistic(observer.options);
      return result.data as T;
    },
    set: (updater) => {
      client.setQueryData<T>(queryKey, updater as never);
    },
  };
}
