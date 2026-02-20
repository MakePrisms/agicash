import type { Cache } from '@agicash/core/interfaces/cache';
import type { QueryClient } from '@tanstack/react-query';

export function queryClientAsCache(qc: QueryClient): Cache {
  return {
    fetchQuery: (opts) => qc.fetchQuery(opts),
    cancelQueries: (params) => qc.cancelQueries(params),
  };
}
