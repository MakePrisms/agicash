// React binding for the SDK spark-balance tracking + the spark debug-logging
// feature-flag wiring. The spark connection layer lives in
// @agicash/wallet-sdk/spark.
import { setSparkDebugLogging } from '@agicash/wallet-sdk/spark';
import { useEffect } from 'react';
import { useAccounts } from '../accounts/account-hooks';
import { getFeatureFlag } from './feature-flags';
// Configures the SDK (incl. the spark/Breez API key) for every import path
// that reaches spark — including the server-side lightning-address flow.
import { getSdk } from './sdk';

// Wired here rather than in shared/sdk.ts: the feature-flag module reads from
// the DB client, which configures through shared/sdk.ts — importing it there
// would create an import cycle.
setSparkDebugLogging(() => getFeatureFlag('DEBUG_LOGGING_SPARK'));

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkOnlineAccounts } = useAccounts({
    type: 'spark',
    isOnline: true,
  });

  useEffect(
    () => getSdk().accounts.trackSparkBalances(sparkOnlineAccounts),
    [sparkOnlineAccounts],
  );
}
