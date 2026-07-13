import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkAccount } from '@agicash/wallet-sdk/temporary';
import { sparkDebugLog, toDomainAccount } from '@agicash/wallet-sdk/temporary';
import { useEffect } from 'react';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkOnlineAccounts } = useAccounts({
    type: 'spark',
    isOnline: true,
  });
  const accountCache = useAccountsCache();

  useEffect(() => {
    const registrations = sparkOnlineAccounts.map((projection) => {
      const account = toDomainAccount(projection) as SparkAccount;
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
