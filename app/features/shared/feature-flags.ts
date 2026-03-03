import * as Sentry from '@sentry/react-router';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { getQueryClient } from '~/features/shared/query-client';

export type FeatureFlag = 'GUEST_SIGNUP' | 'GIFT_CARDS' | 'DEBUG_LOGGING_SPARK';

type FeatureFlags = Record<FeatureFlag, boolean>;

const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  GUEST_SIGNUP: false,
  GIFT_CARDS: false,
  DEBUG_LOGGING_SPARK: false,
};

const MAX_RETRIES = 3;

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  const { data, error } = await agicashDbClient.rpc('evaluate_feature_flags');
  if (error) {
    throw new Error('Failed to fetch feature flags', { cause: error });
  }
  return data as FeatureFlags;
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
 * Reads a feature flag from the query cache.
 * Returns the default value if flags haven't been fetched yet.
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  const data = getQueryClient().getQueryData<FeatureFlags>(
    featureFlagsQueryOptions.queryKey,
  );
  return data?.[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
}
