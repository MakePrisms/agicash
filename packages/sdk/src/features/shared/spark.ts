import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import type { Cache } from '../../interfaces/cache';
import { Money } from '../../lib/money';
import { computeSHA256 } from '../../lib/sha256';
import { createSparkWalletStub } from '../../lib/spark/utils';
import { measureOperation } from '../../performance';

/**
 * Cache key for the spark wallet, based on a hash of the mnemonic and network.
 */
export function sparkWalletCacheKey(mnemonic: string, network: SparkNetwork) {
  return ['spark-wallet', computeSHA256(mnemonic), network] as const;
}

/**
 * Initializes a Spark wallet via a cache (or creates one if not cached).
 * Returns the wallet, balance, and online status.
 */
async function initializeSparkWallet(
  mnemonic: string,
  network: SparkNetwork,
): Promise<SparkWallet> {
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
}

/**
 * Initializes a Spark wallet with offline handling.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * @param cache - The cache interface to use for async queries and caching.
 * @param mnemonic - The Spark wallet mnemonic.
 * @param network - The Spark network that the wallet is on.
 * @returns The wallet, balance and online status.
 */
export async function getInitializedSparkWallet(
  cache: Cache,
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
        const wallet = await cache.fetchQuery({
          queryKey: [...sparkWalletCacheKey(mnemonic, network)],
          queryFn: () =>
            measureOperation(
              'SparkWallet.initialize',
              () => initializeSparkWallet(mnemonic, network),
              { 'spark.network': network },
            ),
          staleTime: Number.POSITIVE_INFINITY,
        });
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
