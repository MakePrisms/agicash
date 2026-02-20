import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import type { SparkProto } from '@buildonspark/spark-sdk/types';

type TreeNode = SparkProto.TreeNode;

import type { Cache } from '../../interfaces/cache';
import { Money } from '../../lib/money';
import { computeSHA256 } from '../../lib/sha256';
import { createSparkWalletStub } from '../../lib/spark';
import { measureOperation } from '../../performance';

export function getLeafDenominations(leaves: TreeNode[]) {
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

/**
 * Initializes a Spark wallet with offline handling.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * @param cache - The cache to use for async queries and caching.
 * @param mnemonic - The Spark wallet mnemonic.
 * @param network - The Spark network that the wallet is on.
 * @returns The wallet, balance and online status.
 */
export async function getInitializedSparkWallet(
  cache: Cache,
  mnemonic: string,
  network: SparkNetwork,
): Promise<{ wallet: SparkWallet; balance: Money | null; isOnline: boolean }> {
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const wallet = await cache.fetchQuery({
          queryKey: ['spark-wallet', computeSHA256(mnemonic), network],
          queryFn: async () => {
            const w = await measureOperation(
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

            return w;
          },
          staleTime: Number.POSITIVE_INFINITY,
        });
        const [
          { balance: balanceSats },
          leaves,
          identityPublicKey,
          isOptimizing,
        ] = await Promise.all([
          measureOperation('SparkWallet.getBalance', () => wallet.getBalance()),
          wallet.getLeaves(true),
          wallet.getIdentityPublicKey(),
          wallet.isOptimizationInProgress(),
        ]);
        console.debug('Fetched Spark balance to initialize wallet', {
          balance: balanceSats.toString(),
          network,
          identityPublicKey,
          isOptimizing,
          leaves: getLeafDenominations(leaves),
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
