import * as Sentry from '@sentry/react-router';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { agicashDbClient } from '~/features/agicash-db/database.client';

export type FeatureFlag = 'GUEST_SIGNUP' | 'GIFT_CARDS';

type FeatureFlags = Record<FeatureFlag, boolean>;

const FEATURE_FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
  GUEST_SIGNUP: false,
  GIFT_CARDS: false,
};

export const featureFlagsQueryOptions = queryOptions({
  queryKey: ['feature-flags'],
  queryFn: async () => {
    const { data, error } = await agicashDbClient.rpc('evaluate_feature_flags');
    if (error) {
      throw new Error('Failed to fetch feature flags', { cause: error });
    }
    return data as FeatureFlags;
  },
  retry: 2,
  staleTime: 5 * 60 * 1000,
  throwOnError: (error) => {
    Sentry.captureException(error);
    return false;
  },
});

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useQuery(featureFlagsQueryOptions);
  return data?.[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
}
