// The framework-free spark connection layer (mnemonic/identity/wallet
// queryOptions, wallet init, sparkDebugLog) moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR. The React hook below stays in
// the web app.
import { setSparkDebugLogging } from '@agicash/wallet-sdk/spark';
import { useEffect } from 'react';
import { useAccounts } from '../accounts/account-hooks';
import { getFeatureFlag } from './feature-flags';
// Configures the SDK (incl. the spark/Breez API key) for every import path
// that reaches spark — including the server-side lightning-address flow.
import { getSdk } from './sdk';

export * from '@agicash/wallet-sdk/spark';

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
