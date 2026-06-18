import type { Sdk } from '@agicash/wallet-sdk';
import useLocationData from '~/hooks/use-location';
import { getSdk } from './sdk';

/**
 * The browser SDK promise for the current lud16 domain (derived from the root
 * loader's canonical origin). Read query hooks await this inside their queryFn:
 * `const sdk = useSdk(); ... return (await sdk).accounts.list();`. `getSdk`
 * memoizes the promise, so calling this every render is cheap.
 */
export function useSdk(): Promise<Sdk> {
  const { domain } = useLocationData();
  return getSdk(domain);
}
