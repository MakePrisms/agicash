import type { AgicashDb } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import { captureException } from './error-reporting';

export type FeatureFlag = 'GUEST_SIGNUP' | 'DEBUG_LOGGING_SPARK';

type FeatureFlags = Record<FeatureFlag, boolean>;

const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  GUEST_SIGNUP: false,
  DEBUG_LOGGING_SPARK: false,
};

const MAX_RETRIES = 3;

/** The cache key for the current session's evaluated feature flags. */
export const featureFlagsQueryKey = 'feature-flags';

export type FeatureFlagsOptions = {
  queryKey: string[];
  queryFn: () => Promise<FeatureFlags>;
  retry: false;
  staleTime: number;
};

export type FeatureFlagsApi = {
  /**
   * Query config for the current session's feature flags (consume with
   * useSuspenseQuery). The flags are evaluated server-side for the current
   * session, so they re-evaluate when the session changes — the auth domain
   * triggers that invalidation through the SDK root.
   */
  options: () => FeatureFlagsOptions;
  /**
   * Reads a flag from the in-memory cache; returns the default when the flags
   * have not been fetched yet.
   */
  get: (flag: FeatureFlag) => boolean;
  /** Re-evaluates the flags (e.g. after the session changed). */
  invalidate: () => Promise<void>;
};

export type FeatureFlagsApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
};

/**
 * Feature flags are evaluated by the `evaluate_feature_flags` wallet RPC for
 * the current session (anon before login, user-targeted after). Failing fetches
 * fall back to the safe-off defaults rather than throwing, so a flag outage
 * never breaks the app.
 */
export function createFeatureFlagsApi(
  deps: FeatureFlagsApiDeps,
): FeatureFlagsApi {
  const { queryClient, db } = deps;

  const fetchFeatureFlags = async (): Promise<FeatureFlags> => {
    const { data, error } = await db.rpc('evaluate_feature_flags');
    if (error) {
      throw new Error('Failed to fetch feature flags', { cause: error });
    }
    return data as FeatureFlags;
  };

  return {
    options: () => ({
      queryKey: [featureFlagsQueryKey],
      queryFn: async (): Promise<FeatureFlags> => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await fetchFeatureFlags();
          } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * 2 ** attempt),
              );
            }
          }
        }
        captureException(lastError);
        return FEATURE_FLAG_DEFAULTS;
      },
      retry: false,
      staleTime: 5 * 60 * 1000,
    }),
    get: (flag) => {
      const data = queryClient.getQueryData<FeatureFlags>([
        featureFlagsQueryKey,
      ]);
      return data?.[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
    },
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: [featureFlagsQueryKey],
        refetchType: 'all',
      }),
  };
}
