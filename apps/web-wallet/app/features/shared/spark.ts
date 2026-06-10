// The framework-free spark connection layer (mnemonic/identity/wallet
// queryOptions, wallet init, sparkDebugLog) moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR. The env reading, the spark
// configuration, and the React hook below stay in the web app.
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { configureSpark, sparkDebugLog } from '@agicash/wallet-sdk/spark';
import { useEffect } from 'react';
import { Money } from '~/lib/money';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getFeatureFlag } from './feature-flags';

export * from '@agicash/wallet-sdk/spark';

const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
if (!apiKey) {
  throw new Error('VITE_BREEZ_API_KEY is not set');
}

configureSpark({
  apiKey,
  isDebugLoggingEnabled: () => getFeatureFlag('DEBUG_LOGGING_SPARK'),
});

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
