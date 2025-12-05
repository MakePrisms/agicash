import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import { getPrivateKey as getMnemonic } from '@opensecret/react';
import {
  type QueryClient,
  queryOptions,
  useQueries,
} from '@tanstack/react-query';
import { type Currency, Money } from '~/lib/money';
import { getSparkIdentityPublicKeyFromMnemonic } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import {
  type AccountsCache,
  useAccounts,
  useAccountsCache,
} from '../accounts/account-hooks';
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
      const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonicToUse,
        options: { network },
      });
      return wallet;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

export function sparkBalanceQueryKey(accountId: string) {
  return ['spark-balance', accountId];
}

export const sparkBalanceQueryOptions = ({
  account,
  accountCache,
}: { account: SparkAccount; accountCache: AccountsCache }) =>
  queryOptions({
    queryKey: sparkBalanceQueryKey(account.id),
    queryFn: async () => {
      if (account.currency !== 'BTC') {
        throw new Error(
          `Spark account ${account.id} has unsupported currency: ${account.currency}`,
        );
      }

      if (!account.wallet) {
        return null;
      }

      const { balance } = await account.wallet.getBalance();

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
  });

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const accountCache = useAccountsCache();

  useQueries({
    queries: sparkAccounts.map((account) => ({
      ...sparkBalanceQueryOptions({ account, accountCache }),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchInterval: 3000,
      refetchOnWindowFocus: 'always' as const,
      refetchOnReconnect: 'always' as const,
    })),
  });
}
