import {
  type BreezSdk,
  type SdkEvent,
  connect,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { computeSHA256 } from '~/lib/sha256';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
  moneyFromSats,
} from '~/lib/spark';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import {
  type SparkNetwork,
  toBreezNetwork,
} from '../agicash-db/json-models/spark-account-details-db-data';
import { getFeatureFlag } from './feature-flags';

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
}: {
  queryClient: QueryClient;
  network: SparkNetwork;
}) =>
  queryOptions({
    queryKey: ['spark-identity-public-key'],
    queryFn: async () => {
      const mnemonic = await queryClient.fetchQuery(
        sparkMnemonicQueryOptions(),
      );
      return await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        toBreezNetwork(network),
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
      const breezNetwork = toBreezNetwork(network);
      const apiKey = import.meta.env.VITE_BREEZ_API_KEY;

      // initLogging is idempotent — safe to call multiple times
      try {
        await initLogging({
          log(logEntry) {
            sparkDebugLog(`[Breez ${logEntry.level}] ${logEntry.line}`);
          },
        });
      } catch {
        // Already initialized — ignore
      }

      const config = defaultConfig(breezNetwork);
      // Verify privacy is enabled by default
      if (!config.privateEnabledDefault) {
        config.privateEnabledDefault = true;
      }
      if (apiKey) {
        config.apiKey = apiKey;
      }

      const sdk = await measureOperation(
        'BreezSdk.connect',
        () =>
          connect({
            config,
            seed: { type: 'mnemonic', mnemonic },
            storageDir: `spark-${breezNetwork}`,
          }),
        { 'spark.network': network },
      );

      return sdk;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

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
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
}> {
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const wallet = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network, mnemonic }),
        );
        const info = await measureOperation('BreezSdk.getInfo', () =>
          wallet.getInfo({}),
        );

        const balance = moneyFromSats(info.balanceSats) as Money;
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

export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const accountCache = useAccountsCache();

  useEffect(() => {
    let cancelled = false;
    const listenerIds: { sdk: BreezSdk; id: string }[] = [];

    for (const account of sparkAccounts) {
      if (!account.isOnline) continue;

      const sdk = account.wallet;

      sdk
        .addEventListener({
          onEvent(event: SdkEvent) {
            if (cancelled) return;

            sparkDebugLog('Breez event', {
              accountId: account.id,
              type: event.type,
            });

            if (
              event.type === 'paymentSucceeded' ||
              event.type === 'paymentPending' ||
              event.type === 'synced'
            ) {
              sdk.getInfo({}).then((info) => {
                if (cancelled) return;
                const balance = moneyFromSats(info.balanceSats) as Money;
                accountCache.updateSparkAccountBalance({
                  accountId: account.id,
                  balance,
                });
              });
            }
          },
        })
        .then((listenerId) => {
          if (cancelled) {
            sdk.removeEventListener(listenerId).catch(() => {
              // intentional no-op
            });
            return;
          }
          listenerIds.push({ sdk, id: listenerId });
          sparkDebugLog('Registered event listener', {
            accountId: account.id,
            listenerId,
          });
        });
    }

    return () => {
      cancelled = true;
      for (const { sdk, id } of listenerIds) {
        sdk.removeEventListener(id).catch(() => {
          // intentional no-op
        });
      }
    };
  }, [sparkAccounts, accountCache]);
}
