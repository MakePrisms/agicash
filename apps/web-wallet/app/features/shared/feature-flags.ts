import type { FeatureFlag } from '@agicash/wallet-sdk/feature-flags';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useSdk } from './sdk';

export type { FeatureFlag };

/**
 * useSdk() throws on SSR, which is safe here: every flag consumer (the auth
 * routes and the cashu-token route) forces client rendering via
 * `clientLoader.hydrate`, so this never renders server-side. (useAuthState
 * differs — its authQueryOptions defers the SDK into the queryFn because public
 * pages build it during SSR.)
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const sdk = useSdk();
  const { data } = useSuspenseQuery(sdk.featureFlags.options());
  return data[flag];
}
