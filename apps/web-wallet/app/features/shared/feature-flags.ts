import * as Sentry from '@sentry/react-router';
import {
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { getQueryClient } from '~/features/shared/query-client';

export type FeatureFlag =
  | 'GUEST_SIGNUP'
  | 'DEBUG_LOGGING_SPARK'
  | 'WALLET_OPERATIONS';

type FeatureFlags = Record<FeatureFlag, boolean>;

const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  GUEST_SIGNUP: false,
  DEBUG_LOGGING_SPARK: false,
  // Gates the core wallet, so a failed fetch must not lock users out.
  WALLET_OPERATIONS: true,
};

const MAX_RETRIES = 3;

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  const { data, error } = await agicashDbClient.rpc('evaluate_feature_flags');
  if (error) {
    throw new Error('Failed to fetch feature flags', { cause: error });
  }
  // A flag row is missing until its migration runs, so defaults fill the gaps.
  return { ...FEATURE_FLAG_DEFAULTS, ...(data as Partial<FeatureFlags>) };
}

export const featureFlagsQueryOptions = queryOptions({
  queryKey: ['feature-flags'],
  queryFn: async (): Promise<FeatureFlags> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fetchFeatureFlags();
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    }
    Sentry.captureException(lastError);
    return FEATURE_FLAG_DEFAULTS;
  },
  retry: false,
  staleTime: 5 * 60 * 1000,
});

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSuspenseQuery(featureFlagsQueryOptions);
  return data[flag];
}

/**
 * Like {@link useFeatureFlag} but never suspends, so it is safe in server-rendered trees.
 * Returns the default value until the flags are fetched.
 */
export function useFeatureFlagOrDefault(flag: FeatureFlag): boolean {
  const { data } = useQuery(featureFlagsQueryOptions);
  return data?.[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
}

/**
 * Reads a feature flag from the query cache.
 * Returns the default value if flags haven't been fetched yet.
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  const data = getQueryClient().getQueryData<FeatureFlags>(
    featureFlagsQueryOptions.queryKey,
  );
  return data?.[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
}
