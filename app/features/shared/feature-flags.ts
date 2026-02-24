import { useQueryClient } from '@tanstack/react-query';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { agicashDbAnon } from '~/features/agicash-db/database.anon';
import { agicashDbClient } from '~/features/agicash-db/database.client';

export type FeatureFlag = 'GUEST_SIGNUP' | 'GIFT_CARDS';

type FeatureFlags = Partial<Record<FeatureFlag, boolean>>;

const FEATURE_FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
  GUEST_SIGNUP: false,
  GIFT_CARDS: false,
};

function featureFlagsQuery(mode: 'anon' | 'authed') {
  const client = mode === 'anon' ? agicashDbAnon : agicashDbClient;
  return queryOptions({
    queryKey: ['feature-flags', mode],
    queryFn: async () => {
      const { data, error } = await client.rpc('evaluate_feature_flags');
      if (error) {
        console.error(`Failed to fetch ${mode} feature flags`, {
          cause: error,
        });
        return {} as FeatureFlags;
      }
      return data as FeatureFlags;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Prefetched in root middleware. */
export const anonFeatureFlagsQueryOptions = featureFlagsQuery('anon');

/** Prefetched in _protected middleware. */
export const authedFeatureFlagsQueryOptions = featureFlagsQuery('authed');

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const queryClient = useQueryClient();
  const hasAuthedFlags =
    queryClient.getQueryData(authedFeatureFlagsQueryOptions.queryKey) !==
    undefined;
  const options = hasAuthedFlags
    ? authedFeatureFlagsQueryOptions
    : anonFeatureFlagsQueryOptions;
  const { data } = useSuspenseQuery(options);
  return data[flag] ?? FEATURE_FLAG_DEFAULTS[flag];
}
