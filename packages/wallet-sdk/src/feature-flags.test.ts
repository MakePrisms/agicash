import { afterEach, describe, expect, it } from 'bun:test';
import type { AgicashDb } from '@agicash/db-types';
import { QueryClient } from '@tanstack/query-core';
import { setErrorReporter } from './error-reporting';
import { createFeatureFlagsApi, featureFlagsQueryKey } from './feature-flags';

// Locks the feature-flags fallback contract: a flag-evaluation outage must
// degrade to safe-off defaults (never throw), reads return defaults until the
// flags load, and a successful evaluation is returned verbatim.

type RpcResult = { data: unknown; error: unknown };

const stubDb = (rpc: () => Promise<RpcResult>): AgicashDb =>
  ({ rpc }) as unknown as AgicashDb;

afterEach(() => {
  setErrorReporter(() => undefined);
});

describe('feature flags', () => {
  it('get() returns the safe-off default when flags are not loaded', () => {
    const api = createFeatureFlagsApi({
      queryClient: new QueryClient(),
      db: stubDb(async () => ({ data: null, error: null })),
    });
    expect(api.get('GUEST_SIGNUP')).toBe(false);
  });

  it('get() returns the cached value once loaded', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData([featureFlagsQueryKey], {
      GUEST_SIGNUP: true,
      DEBUG_LOGGING_SPARK: false,
    });
    const api = createFeatureFlagsApi({
      queryClient,
      db: stubDb(async () => ({ data: null, error: null })),
    });
    expect(api.get('GUEST_SIGNUP')).toBe(true);
  });

  it('options().queryFn returns the evaluated flags on success', async () => {
    const api = createFeatureFlagsApi({
      queryClient: new QueryClient(),
      db: stubDb(async () => ({
        data: { GUEST_SIGNUP: true, DEBUG_LOGGING_SPARK: true },
        error: null,
      })),
    });
    expect(await api.options().queryFn()).toEqual({
      GUEST_SIGNUP: true,
      DEBUG_LOGGING_SPARK: true,
    });
  });

  it('options().queryFn falls back to safe-off defaults (and reports) when the RPC keeps failing', async () => {
    let reported: unknown;
    setErrorReporter((error) => {
      reported = error;
    });
    // Make the retry backoff instant so the test does not wait ~7s.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) =>
      realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    try {
      const api = createFeatureFlagsApi({
        queryClient: new QueryClient(),
        db: stubDb(async () => ({ data: null, error: { message: 'boom' } })),
      });
      expect(await api.options().queryFn()).toEqual({
        GUEST_SIGNUP: false,
        DEBUG_LOGGING_SPARK: false,
      });
      expect(reported).toBeDefined();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
