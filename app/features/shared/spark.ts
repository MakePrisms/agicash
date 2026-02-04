import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import { sha256 } from '@noble/hashes/sha2';
import { getPrivateKey as getMnemonic } from '@opensecret/react';
import {
  type QueryClient,
  queryOptions,
  useQueries,
} from '@tanstack/react-query';
import { type Currency, Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
} from '~/lib/spark';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getDefaultUnit } from './currencies';

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
}: { network: SparkNetwork; mnemonic?: string }) =>
  queryOptions({
    queryKey: ['spark-wallet', network],
    queryFn: async ({ client }) => {
      const mnemonicToUse =
        mnemonic ?? (await client.fetchQuery(sparkMnemonicQueryOptions()));

      const wallet = await measureOperation(
        'SparkWallet.initialize',
        async () => {
          const { wallet } = await SparkWallet.initialize({
            mnemonicOrSeed: mnemonicToUse,
            options: {
              network,
              optimizationOptions: {
                auto: true,
                multiplicity: 5,
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

        const { balance } = await measureOperation(
          'SparkWallet.getBalance',
          () => account.wallet.getBalance(),
          { accountId: account.id },
        );
        const identityPublicKey = await account.wallet.getIdentityPublicKey();
        console.debug('Fetched Spark balance', {
          accountId: account.id,
          balance: balance.toString(),
          network: account.network,
          identityPublicKey,
        });

        accountCache.updateSparkBalance({
          ...account,
          balance: new Money({
            amount: Number(balance),
            currency: account.currency as Currency,
            unit: getDefaultUnit(account.currency),
          }),
        });

        return balance;
      },
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchInterval: 3000,
      refetchOnWindowFocus: 'always' as const,
      refetchOnReconnect: 'always' as const,
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
): Promise<{ wallet: SparkWallet; balance: Money | null; isOnline: boolean }> {
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const wallet = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network, mnemonic }),
        );
        const identityPublicKey = await wallet.getIdentityPublicKey();
        const { balance: balanceSats } = await measureOperation(
          'SparkWallet.getBalance',
          () => wallet.getBalance(),
        );
        console.debug('Fetched Spark balance to initialize wallet', {
          balance: balanceSats.toString(),
          network,
          mnemonicHash: sha256(mnemonic),
          identityPublicKey,
        });
        const balance = new Money({
          amount: Number(balanceSats),
          currency: 'BTC',
          unit: 'sat',
        }) as Money;
        return { wallet, balance, isOnline: true };
      } catch (error) {
        console.error('Failed to initialize spark wallet', { cause: error });
        return {
          wallet: createSparkWalletStub(
            'Spark is offline, please try again later.',
          ),
          balance: null,
          isOnline: false,
        };
      }
    },
    { sparkNetwork: network },
  );
}
