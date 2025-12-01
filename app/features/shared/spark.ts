import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import { getPrivateKey as getMnemonic } from '@opensecret/react';
import {
  type QueryClient,
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Money } from '~/lib/money';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccountsCache, useSparkAccount } from '../accounts/account-hooks';
import { getDefaultUnit } from './currencies';

const seedDerivationPath = getSeedPhraseDerivationPath('spark', 12);

const mnemonicQueryOptions = () =>
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

export const sparkWalletQueryOptions = ({
  network,
  mnemonic,
}: { network: SparkNetwork; mnemonic?: string }) =>
  queryOptions({
    queryKey: ['spark-wallet', network],
    queryFn: async ({ client }) => {
      const mnemonicToUse =
        mnemonic ?? (await client.fetchQuery(mnemonicQueryOptions()));
      const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonicToUse,
        options: { network },
      });
      return wallet;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

export function getSparkWalletFromCache(
  queryClient: QueryClient,
  network: SparkNetwork,
): SparkWallet | undefined {
  return queryClient.getQueryData<SparkWallet>(['spark-wallet', network]);
}

export function useSparkWallet(): SparkWallet {
  const sparkAccount = useSparkAccount();
  const { data } = useSuspenseQuery(
    sparkWalletQueryOptions({ network: sparkAccount.network }),
  );
  return data;
}

export function useTrackAndUpdateSparkBalance() {
  const sparkWallet = useSparkWallet();
  const sparkAccount = useSparkAccount();
  const accountCache = useAccountsCache();

  useQuery({
    queryKey: ['spark-balance', sparkAccount.id],
    queryFn: async () => {
      const { balance } = await sparkWallet.getBalance();
      accountCache.update({
        ...sparkAccount,
        balance: new Money({
          amount: Number(balance),
          currency: sparkAccount.currency,
          unit: getDefaultUnit(sparkAccount.currency),
        }),
      });
      return balance;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchInterval: 3000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}
