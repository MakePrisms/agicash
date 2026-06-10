// The framework-free spark connection layer (mnemonic/identity/wallet
// queryOptions, wallet init, sparkDebugLog) moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR. The React hook below stays in
// the web app.
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { setSparkDebugLogging, sparkDebugLog } from '@agicash/wallet-sdk/spark';
import { useEffect } from 'react';
import { Money } from '~/lib/money';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getFeatureFlag } from './feature-flags';
// Configures the SDK (incl. the spark/Breez API key) for every import path
// that reaches spark — including the server-side lightning-address flow.
import './sdk';

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
  const accountCache = useAccountsCache();

  useEffect(() => {
    const registrations = sparkOnlineAccounts.map((account) => {
      const listenerPromise = account.wallet.addEventListener({
        onEvent(event: SdkEvent) {
          sparkDebugLog('Breez event', {
            accountId: account.id,
            type: event.type,
          });

          if (
            event.type === 'paymentSucceeded' ||
            event.type === 'paymentPending' ||
            event.type === 'paymentFailed' ||
            event.type === 'claimedDeposits' ||
            event.type === 'synced'
          ) {
            account.wallet.getInfo({}).then((info) => {
              const balance = new Money({
                amount: info.balanceSats,
                currency: 'BTC',
                unit: 'sat',
              }) as Money;
              accountCache.updateSparkAccountBalance({
                accountId: account.id,
                balance,
              });
            });
          }
        },
      });
      return { wallet: account.wallet, listenerPromise };
    });

    return () => {
      for (const { wallet, listenerPromise } of registrations) {
        listenerPromise
          .then((id) => wallet.removeEventListener(id))
          .catch(() => {
            console.warn('Failed to remove Spark event listener');
          });
      }
    };
  }, [sparkOnlineAccounts, accountCache]);
}
