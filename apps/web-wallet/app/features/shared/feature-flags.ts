import type { FeatureFlag, FeatureFlags } from '@agicash/wallet-sdk';
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlagService,
} from '@agicash/wallet-sdk/temporary';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { getQueryClient } from '~/features/shared/query-client';

const featureFlagService = new FeatureFlagService(agicashDbClient);

const MAX_RETRIES = 3;

export const featureFlagsQueryOptions = queryOptions({
  queryKey: ['feature-flags'],
  queryFn: async (): Promise<FeatureFlags> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await featureFlagService.fetchAll();
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    }
    console.error('Failed to fetch feature flags', lastError);
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
