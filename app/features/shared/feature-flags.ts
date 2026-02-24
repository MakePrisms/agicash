import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
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
      console.error('Failed to fetch feature flags', { cause: error });
      return FEATURE_FLAG_DEFAULTS;
    }
    return data as FeatureFlags;
  },
  staleTime: 5 * 60 * 1000,
});

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSuspenseQuery(featureFlagsQueryOptions);
  return data[flag];
}
