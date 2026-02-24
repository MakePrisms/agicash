import { createClient } from '@supabase/supabase-js';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import type { Database } from '~/features/agicash-db/database';

export type FeatureFlag = 'GUEST_SIGNUP' | 'GIFT_CARDS';

type FeatureFlags = Partial<Record<FeatureFlag, boolean>>;

/**
 * Anon-only Supabase client for feature flag evaluation.
 * Uses the anon key without a custom accessToken so it works before the user
 * has authenticated. The evaluate_feature_flags() function is security definer
 * and granted to anon, so no JWT is required.
 */
const featureFlagsClient = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  { db: { schema: 'wallet' } },
);

const featureFlagsQueryOptions = queryOptions({
  queryKey: ['feature-flags'],
  queryFn: async () => {
    const { data, error } = await featureFlagsClient.rpc(
      'evaluate_feature_flags',
    );
    if (error) {
      console.error('Failed to fetch feature flags', { cause: error });
      return {} as FeatureFlags;
    }
    return (data ?? {}) as FeatureFlags;
  },
  staleTime: 5 * 60 * 1000,
});

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSuspenseQuery(featureFlagsQueryOptions);
  return data[flag] ?? false;
}
