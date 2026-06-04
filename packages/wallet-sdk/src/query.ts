/**
 * SDK-internal reactive runtime — the TanStack Query adapter.
 *
 * `toQuery` wraps a TanStack `QueryObserver` behind the SDK's lib-agnostic
 * `Query<T>` contract. The observer (and the `QueryClient` it is attached to)
 * are entirely PRIVATE — consumers only ever see `Query<T>`, so swapping out
 * TanStack touches only this module and the domain implementations, zero
 * consumer change.
 *
 * The `QueryClient` is created ONCE inside `Sdk.create` and distributed to
 * domain implementations via the `SdkConnections` bundle. Domains memo their
 * per-key `Query<T>` instances (stable refs) so repeated calls to e.g.
 * `sdk.accounts.list()` return the SAME object.
 *
 * NOT part of the public barrel — internal seam only.
 *
 * @module
 */
import {
  QueryClient,
  type QueryKey,
  QueryObserver,
} from '@tanstack/query-core';
import type { Query, QueryState } from './types/query';

export { QueryClient };

/**
 * Build a `Query<T>` that is backed by a TanStack `QueryObserver`.
 *
 * The raw `QueryObserverResult` is structurally assignable to `QueryState<T>`
 * (the SDK curates a SUBSET of TanStack's fields; field names match exactly)
 * so `getSnapshot` returns it directly — no mapping, no memo overhead.
 *
 * @param client - the SDK-internal `QueryClient` (never exposed to consumers).
 * @param key - TanStack query key; domain implementations own their key shapes.
 * @param fn - the async fetcher (same as TanStack `queryFn`).
 * @returns a stable `Query<T>` handle.
 */
export function toQuery<T>(
  client: QueryClient,
  key: QueryKey,
  fn: () => Promise<T>,
): Query<T> {
  const obs = new QueryObserver<T>(client, { queryKey: key, queryFn: fn });
  return {
    // Raw observer result is structurally assignable to QueryState<T>
    // (matching field names) — no map, no memo.
    // getCurrentResult() already returns a stable ref (TanStack memoizes via
    // shallowEqualObjects).
    getSnapshot: (): QueryState<T> =>
      obs.getCurrentResult() as unknown as QueryState<T>,

    subscribe(onData, onError) {
      // biome-ignore lint/suspicious/noExplicitAny: raw observer result; we narrow via isError/data
      const emit = (r: any) =>
        r.isError
          ? onError?.(r.error)
          : r.data !== undefined && onData(r.data as T);
      const off = obs.subscribe(emit);
      // Emit the current value immediately so callers don't wait for the first
      // mutation to receive the already-cached result.
      emit(obs.getCurrentResult());
      return off;
    },

    // fetchQuery returns the DEDUPED in-flight promise — `query.fetch()` returns
    // the same `#retryer.promise` while fetching, so concurrent callers share one
    // request and the promise resolves only once.
    toPromise: () => client.fetchQuery({ queryKey: key, queryFn: fn }),

    refetch: () => obs.refetch().then((r) => r.data as T),
  };
}
