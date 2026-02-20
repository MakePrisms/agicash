/**
 * Minimal cache interface. Replaces QueryClient dependency in core.
 * Web: wraps QueryClient. CLI: Map-backed.
 */
export type Cache = {
  fetchQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
  }): Promise<T>;

  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
};
