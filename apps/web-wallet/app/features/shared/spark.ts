// React binding for the SDK spark-balance tracking. The spark connection layer
// lives in @agicash/wallet-sdk/spark; the DEBUG_LOGGING_SPARK wiring now lives
// in the SDK root alongside the feature-flags domain.
import { useEffect } from 'react';
import { useAccounts } from '../accounts/account-hooks';
// Configures the SDK (incl. the spark/Breez API key) for every import path
// that reaches spark — including the server-side lightning-address flow.
import { useSdk } from './sdk';

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkOnlineAccounts } = useAccounts({
    type: 'spark',
    isOnline: true,
  });
  const sdk = useSdk();

  useEffect(
    () => sdk.accounts.trackSparkBalances(sparkOnlineAccounts),
    [sparkOnlineAccounts, sdk],
  );
}
