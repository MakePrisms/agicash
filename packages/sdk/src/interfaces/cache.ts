export type Cache = {
  fetchQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
  }): Promise<T>;

  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
  setQueryData?<T>(queryKey: readonly unknown[], data: T): void;
  invalidateQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
};
