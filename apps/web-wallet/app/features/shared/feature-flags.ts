import type { FeatureFlag } from '@agicash/wallet-sdk/feature-flags';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getSdk } from './sdk';

export type { FeatureFlag };

/**
 * Calling getSdk() (client-only) directly is safe here — every flag consumer
 * (the auth routes and the cashu-token route) forces client rendering via
 * `clientLoader.hydrate`, so this never runs during SSR/prerender. This is
 * unlike useAuthState, whose authQueryOptions defers getSdk() into the queryFn
 * because public pages build it server-side.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSuspenseQuery(getSdk().featureFlags.options());
  return data[flag];
}
