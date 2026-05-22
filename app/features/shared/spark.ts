import {
  type BreezSdk,
  type GetInfoResponse,
  SdkBuilder,
  type SdkEvent,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import * as Sentry from '@sentry/react-router';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { useEffect } from 'react';
import { type Currency, Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { computeSHA256 } from '~/lib/sha256';
import {
  type SparkNetwork,
  USDB_MAINNET_ID,
  convertUsdbToMoney,
  createSparkWalletStub,
  getSparkAccountNumber,
  getSparkIdentityPublicKeyFromMnemonic,
  getSparkStableBalanceConfig,
} from '~/lib/spark';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getFeatureFlag } from './feature-flags';

const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
if (!apiKey) {
  throw new Error('VITE_BREEZ_API_KEY is not set');
}

export function sparkDebugLog(message: string, data?: Record<string, unknown>) {
  if (getFeatureFlag('DEBUG_LOGGING_SPARK')) {
    console.debug(`[Spark] ${message}`, data ?? '');
  }
}

// Breez's initLogging delegates to Rust's tracing crate, which enforces a
// single global subscriber per process — calling it twice always errors. Track
// status so we only attempt init once, regardless of outcome.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;

function tryInitLogging() {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({
    log(logEntry) {
      if (getFeatureFlag('DEBUG_LOGGING_SPARK')) {
        console.debug(`[Breez ${logEntry.level}] ${logEntry.line}`);
      }
    },
  })
    .then(() => {
      loggingStatus = 'initialized';
    })
    .catch((error) => {
      loggingStatus = 'failed';
      console.warn('Failed to initialize Breez SDK logging', error);
    });
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
      return getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        network.toLowerCase() as 'mainnet' | 'regtest',
      );
    },
  });

export const sparkWalletQueryOptions = ({
  network,
  currency,
  mnemonic,
  storageDir,
}: {
  network: SparkNetwork;
  currency: Currency;
  mnemonic: string;
  storageDir: string;
}) =>
  queryOptions({
    queryKey: [
      'spark-wallet',
      computeSHA256(mnemonic),
      network,
      currency,
      storageDir,
    ],
    queryFn: async () => {
      const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';

      tryInitLogging();

      const sdk = await measureOperation(
        'SparkSdk.init',
        async () => {
          const builderWithKeySet = SdkBuilder.new(
            {
              ...defaultConfig(breezNetwork),
              apiKey,
              lnurlDomain: undefined, // Disables Breez's built-in lightning address recovery — we use our own ln address system
              privateEnabledDefault: true,
              optimizationConfig: {
                autoEnabled: true,
                multiplicity: 2,
              },
              stableBalanceConfig: getSparkStableBalanceConfig(
                currency,
                network,
              ),
            },
            { type: 'mnemonic', mnemonic },
          ).withKeySet({
            keySetType: 'default',
            useAddressIndex: false,
            accountNumber: getSparkAccountNumber(currency),
          });
          const builderWithStorage =
            await builderWithKeySet.withDefaultStorage(storageDir);
          return builderWithStorage.build();
        },
        { 'spark.network': network, 'spark.currency': currency },
      );

      return sdk;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

function computeSparkAccountBalance(
  info: GetInfoResponse,
  currency: Currency,
): Money {
  if (currency === 'USD') {
    const raw = info.tokenBalances.get(USDB_MAINNET_ID)?.balance ?? 0n;
    return convertUsdbToMoney(raw) as Money;
  }
  return new Money({
    amount: info.balanceSats,
    currency: 'BTC',
    unit: 'sat',
  }) as Money;
}

/**
 * Initializes a Spark wallet with offline handling.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * @param queryClient - The query client to use for async queries and caching.
 * @param mnemonic - The Spark wallet mnemonic.
 * @param network - The Spark network that the wallet is on.
 * @param currency - The currency of the account this wallet belongs to.
 * @param storageDir - The per-account storage directory for the underlying SDK.
 * @returns The wallet, balance and online status.
 */
export async function getInitializedSparkWallet(
  queryClient: QueryClient,
  mnemonic: string,
  network: SparkNetwork,
  currency: Currency,
  storageDir: string,
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
          sparkWalletQueryOptions({ network, currency, mnemonic, storageDir }),
        );
        const info = await measureOperation('BreezSdk.getInfo', () =>
          wallet.getInfo({}),
        );

        if (currency === 'USD') {
          await measureOperation('BreezSdk.getTokensMetadata', () =>
            wallet.getTokensMetadata({ tokenIdentifiers: [USDB_MAINNET_ID] }),
          );
        }

        const balance = computeSparkAccountBalance(info, currency);
        return { wallet, balance, isOnline: true };
      } catch (error) {
        Sentry.captureException(error, {
          tags: {
            'spark.network': network,
            'spark.currency': currency,
            'spark.account_number': String(getSparkAccountNumber(currency)),
          },
        });
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
    { sparkNetwork: network, sparkCurrency: currency },
  );
}

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
              const balance = computeSparkAccountBalance(
                info,
                account.currency,
              );
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
