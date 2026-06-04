// Core reactive types (design B — TanStack hidden behind Query<T>)
// Web depends only on these; no react-query/TanStack import required.

export type QueryState<T> = {
  status: 'pending' | 'error' | 'success';
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  /** Background-refresh indicator */
  isFetching: boolean;
};

export type Query<T> = {
  subscribe(onData: (d: T) => void, onError?: (e: unknown) => void): () => void;
  toPromise(): Promise<T>;
  refetch(): Promise<T>;
  getSnapshot(): QueryState<T>;
};
