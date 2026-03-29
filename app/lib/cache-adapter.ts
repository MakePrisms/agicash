import type { QueryClient } from '@tanstack/react-query';
import type { Cache } from '@agicash/sdk/interfaces/cache';

export function queryClientAsCache(qc: QueryClient): Cache {
  return {
    fetchQuery: (opts) => qc.fetchQuery(opts),
    cancelQueries: (params) => qc.cancelQueries(params),
    setQueryData: (key, data) => qc.setQueryData(key, data),
    invalidateQueries: (params) => qc.invalidateQueries(params),
  };
}
