import { QueryClient } from '@tanstack/query-core';

/**
 * The hidden Variant-B engine client. Explicit headless defaults because node's
 * `isServer` otherwise flips query retry→0 and gcTime→Infinity silently
 * (query-core utils.ts/removable.ts/retryer.ts). Reads are `staleTime: Infinity`
 * because the change-feed fanout is the authoritative freshness mechanism — a
 * background refetch must never race the fanout's version-gated write. `gcTime:
 * Infinity` keeps the resident stores' cache entries alive for the SDK's lifetime.
 * Mutations use `networkMode: 'always'` so the lane runner never strands a paused
 * lane on an onlineManager flip (the SDK owns its own connectivity).
 */
export function createEngineQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        retry: 3,
      },
      mutations: { networkMode: 'always' },
    },
  });
}
