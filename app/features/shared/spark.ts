import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import {
  type NetworkType as SparkNetwork,
  SparkWallet,
  SparkWalletEvent,
} from '@buildonspark/spark-sdk';
import type { SparkProto } from '@buildonspark/spark-sdk/types';
import {
  type QueryClient,
  queryOptions,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { type Currency, Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { computeSHA256 } from '~/lib/sha256';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
} from '~/lib/spark';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getDefaultUnit } from './currencies';
import { getFeatureFlag } from './feature-flags';

function getLeafDenominations(leaves: SparkProto.TreeNode[]) {
  return Object.entries(
    leaves.reduce(
      (acc, leaf) => {
        acc[leaf.value] = (acc[leaf.value] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    ),
  )
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.value - a.value)
    .map((d) => `${d.count}x ${d.value} sats`);
}

export function sparkDebugLog(message: string, data?: Record<string, unknown>) {
  if (getFeatureFlag('DEBUG_LOGGING_SPARK')) {
    console.debug(`[Spark] ${message}`, data ?? '');
  }
}

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

  useEffectNoStrictMode(() => {
    const walletsWithHandlers = sparkAccounts.map((sparkAccount) => {
      const balanceUpdateHandler = (balance: {
        available: bigint;
        owned: bigint;
        incoming: bigint;
      }) => {
        sparkDebugLog('On balance update handler triggered', {
          accountId: sparkAccount.id,
          balance,
        });
      };

      return {
        accountId: sparkAccount.id,
        wallet: sparkAccount.wallet,
        balanceUpdateHandler,
      };
    });

    walletsWithHandlers.forEach((x) => {
      x.wallet.on(SparkWalletEvent.BalanceUpdate, x.balanceUpdateHandler);

      sparkDebugLog('Registered BalanceUpdate event handler', {
        accountId: x.accountId,
      });
    });

    return () => {
      walletsWithHandlers.forEach((x) => {
        x.wallet.off(SparkWalletEvent.BalanceUpdate, x.balanceUpdateHandler);
      });
    };
  }, [sparkAccounts]);

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
          sparkDebugLog('Skipping balance poll — account offline', {
            accountId: account.id,
          });
          return null;
        }

        sparkDebugLog('Polling balance', { accountId: account.id });

        const [{ satsBalance }, leaves, identityPublicKey, isOptimizing] =
          await Promise.all([
            measureOperation(
              'SparkWallet.getBalance',
              () => account.wallet.getBalance(),
              { accountId: account.id },
            ),
            account.wallet.getLeaves(true),
            account.wallet.getIdentityPublicKey(),
            account.wallet.isOptimizationInProgress(),
          ]);

        sparkDebugLog('Balance fetched from Spark SDK', {
          accountId: account.id,
          owned: String(satsBalance.owned),
          available: String(satsBalance.available),
          identityPublicKey,
          isOptimizing,
          leaves: getLeafDenominations(leaves),
        });

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

        const newOwnedBalance = new Money({
          amount: Number(effectiveOwnedBalance),
          currency: account.currency as Currency,
          unit: getDefaultUnit(account.currency),
        });
        const newAvailableBalance = new Money({
          amount: Number(effectiveAvailableBalance),
          currency: account.currency as Currency,
          unit: getDefaultUnit(account.currency),
        });

        sparkDebugLog('Updating accounts cache', {
          accountId: account.id,
          prevOwned: account.ownedBalance?.toString() ?? 'null',
          newOwned: newOwnedBalance.toString(),
          prevAvailable: account.availableBalance?.toString() ?? 'null',
          newAvailable: newAvailableBalance.toString(),
          walletChanged: String(effectiveWallet !== account.wallet),
          accountVersion: String(account.version),
        });

        accountCache.updateSparkAccountIfBalanceOrWalletChanged({
          ...account,
          wallet: effectiveWallet,
          ownedBalance: newOwnedBalance,
          availableBalance: newAvailableBalance,
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
 * Initializes a Spark wallet with offline handling.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * @param queryClient - The query client to use for async queries and caching.
 * @param mnemonic - The Spark wallet mnemonic.
 * @param network - The Spark network that the wallet is on.
 * @returns The wallet, balance and online status.
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
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const wallet = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network, mnemonic }),
        );
        const { satsBalance } = await measureOperation(
          'SparkWallet.getBalance',
          () => wallet.getBalance(),
        );

        const ownedBalance = new Money({
          amount: Number(satsBalance.owned),
          currency: 'BTC',
          unit: 'sat',
        }) as Money;
        const availableBalance = new Money({
          amount: Number(satsBalance.available),
          currency: 'BTC',
          unit: 'sat',
        }) as Money;
        return { wallet, ownedBalance, availableBalance, isOnline: true };
      } catch (error) {
        console.error('Failed to initialize spark wallet', { cause: error });
        return {
          wallet: createSparkWalletStub(
            'Spark is offline, please try again later.',
          ),
          ownedBalance: null,
          availableBalance: null,
          isOnline: false,
        };
      }
    },
    { sparkNetwork: network },
  );
}
