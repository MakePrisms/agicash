import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import { getSeedPhraseDerivationPath } from '@agicash/sdk/features/accounts/account-cryptography';
import { getDefaultUnit } from '@agicash/sdk/features/shared/currencies';
import { type Currency, Money } from '@agicash/sdk/lib/money/index';
import { computeSHA256 } from '@agicash/sdk/lib/sha256';
import { getSparkIdentityPublicKeyFromMnemonic } from '@agicash/sdk/lib/spark/index';
import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import {
  type QueryClient,
  queryOptions,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { queryClientAsCache } from '~/lib/cache-adapter';
import { measureOperation } from '~/lib/performance';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';

// Re-export SDK items so existing consumers don't break
export {
  getInitializedSparkWallet as getInitializedSparkWalletFromCache,
  sparkWalletCacheKey,
} from '@agicash/sdk/features/shared/spark';

import { getInitializedSparkWallet as getInitializedSparkWalletFromCache } from '@agicash/sdk/features/shared/spark';

const seedDerivationPath = getSeedPhraseDerivationPath('spark', 12);

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-mnemonic'],
    queryFn: async () => {
      const response = await getMnemonic({
        seed_phrase_derivation_path: seedDerivationPath,
      });
      return response.mnemonic;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

export const sparkIdentityPublicKeyQueryOptions = ({
  queryClient,
  network,
  accountNumber,
}: {
  queryClient: QueryClient;
  network: SparkNetwork;
  accountNumber?: number;
}) =>
  queryOptions({
    queryKey: ['spark-identity-public-key'],
    queryFn: async () => {
      const mnemonic = await queryClient.fetchQuery(
        sparkMnemonicQueryOptions(),
      );
      return await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        network,
        accountNumber,
      );
    },
  });

export const sparkWalletQueryOptions = ({
  network,
  mnemonic,
}: { network: SparkNetwork; mnemonic: string }) =>
  queryOptions({
    queryKey: ['spark-wallet', computeSHA256(mnemonic), network],
    queryFn: async () => {
      const wallet = await measureOperation(
        'SparkWallet.initialize',
        async () => {
          const { wallet } = await SparkWallet.initialize({
            mnemonicOrSeed: mnemonic,
            options: {
              network,
              optimizationOptions: {
                auto: true,
                multiplicity: 2,
              },
            },
          });

          // Privacy mode hides the wallet from Spark explorers (e.g. sparkscan.io), but not from Spark Operators.
          // Toggling this setting retroactively hides/reveals all transactions, not just future ones.
          await wallet.setPrivacyEnabled(true);

          return wallet;
        },
        { 'spark.network': network },
      );

      return wallet;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

export function sparkBalanceQueryKey(accountId: string) {
  return ['spark-balance', accountId];
}

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const accountCache = useAccountsCache();
  const queryClient = useQueryClient();

  // Needed for workaround below.
  // TODO: Remove when workaround is removed.
  const verifiedZeroBalanceAccounts = useRef(new Set<string>());

  useEffect(() => {
    const clear = () => verifiedZeroBalanceAccounts.current.clear();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') clear();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', clear);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', clear);
    };
  }, []);
  // end workaround

  useQueries({
    queries: sparkAccounts.map((account) => ({
      queryKey: sparkBalanceQueryKey(account.id),
      queryFn: async () => {
        if (account.currency !== 'BTC') {
          throw new Error(
            `Spark account ${account.id} has unsupported currency: ${account.currency}`,
          );
        }

        if (!account.isOnline) {
          return null;
        }

        const { satsBalance } = await measureOperation(
          'SparkWallet.getBalance',
          () => account.wallet.getBalance(),
          { accountId: account.id },
        );

        // WORKAROUND: Spark SDK sometimes returns 0 for balance incorrectly.
        // The bug seems to be resolved after the wallet is reinitialized.
        // Reinitialize the wallet and re-check balance.
        // TODO: Remove when Spark fixes the bug.
        let effectiveOwnedBalance = satsBalance.owned;
        let effectiveAvailableBalance = satsBalance.available;
        let effectiveWallet = account.wallet;
        if (Number(satsBalance.owned) === 0) {
          if (!verifiedZeroBalanceAccounts.current.has(account.id)) {
            try {
              const {
                ownedBalance: freshOwnedBalance,
                availableBalance: freshAvailableBalance,
                wallet: newWallet,
              } = await measureOperation(
                'SparkWallet.balanceRecovery',
                async () => {
                  console.warn(
                    '[Spark] Balance returned 0, reinitializing wallet',
                    {
                      accountId: account.id,
                      network: account.network,
                    },
                  );

                  const mnemonic = await queryClient.fetchQuery(
                    sparkMnemonicQueryOptions(),
                  );
                  const newWallet = await queryClient.fetchQuery({
                    ...sparkWalletQueryOptions({
                      network: account.network,
                      mnemonic,
                    }),
                    staleTime: 0, // Forces a refetch
                  });

                  const { satsBalance: freshSatsBalance } =
                    await newWallet.getBalance();
                  return {
                    ownedBalance: freshSatsBalance.owned,
                    availableBalance: freshSatsBalance.available,
                    wallet: newWallet,
                  };
                },
                { accountId: account.id },
              );

              effectiveOwnedBalance = freshOwnedBalance;
              effectiveAvailableBalance = freshAvailableBalance;
              effectiveWallet = newWallet;

              if (Number(freshOwnedBalance) === 0) {
                verifiedZeroBalanceAccounts.current.add(account.id);
              }
            } catch (error) {
              console.error('Failed to reinitialize Spark wallet', {
                cause: error,
                accountId: account.id,
              });
              return satsBalance.owned;
            }
          }
        } else {
          verifiedZeroBalanceAccounts.current.delete(account.id);
        }
        // END WORKAROUND

        accountCache.updateSparkAccountIfBalanceOrWalletChanged({
          ...account,
          wallet: effectiveWallet,
          ownedBalance: new Money({
            amount: Number(effectiveOwnedBalance),
            currency: account.currency as Currency,
            unit: getDefaultUnit(account.currency),
          }),
          availableBalance: new Money({
            amount: Number(effectiveAvailableBalance),
            currency: account.currency as Currency,
            unit: getDefaultUnit(account.currency),
          }),
        });

        return effectiveOwnedBalance;
      },
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchInterval: 3000,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    })),
  });
}

/**
 * Backwards-compatible wrapper for getInitializedSparkWallet that accepts a QueryClient.
 * Delegates to the SDK version using the cache adapter.
 */
export async function getInitializedSparkWallet(
  queryClient: QueryClient,
  mnemonic: string,
  network: SparkNetwork,
): Promise<{
  wallet: SparkWallet;
  ownedBalance: Money | null;
  availableBalance: Money | null;
  isOnline: boolean;
}> {
  return getInitializedSparkWalletFromCache(
    queryClientAsCache(queryClient),
    mnemonic,
    network,
  );
}
