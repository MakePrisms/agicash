import {
  type BreezSdk,
  connect,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import { computeSHA256, queryOptions } from '@agicash/utils';
import type { QueryClient } from '@tanstack/query-core';
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
} from '../lib/spark';
import { getSeedPhraseDerivationPath } from './cryptography';

const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
if (!apiKey) {
  throw new Error('VITE_BREEZ_API_KEY is not set');
}

export function sparkDebugLog(
  message: string,
  data: Record<string, unknown> | undefined,
  debugLogging: boolean,
) {
  if (debugLogging) {
    console.debug(`[Spark] ${message}`, data ?? '');
  }
}

// Breez's initLogging delegates to Rust's tracing crate, which enforces a
// single global subscriber per process — calling it twice always errors. Track
// status so we only attempt init once, regardless of outcome.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;

function tryInitLogging(debugLogging: boolean) {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({
    log(logEntry) {
      if (debugLogging) {
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
  mnemonic,
  storageDir,
  debugLogging,
}: {
  network: SparkNetwork;
  mnemonic: string;
  storageDir: string;
  debugLogging: boolean;
}) =>
  queryOptions({
    queryKey: ['spark-wallet', computeSHA256(mnemonic), network, storageDir],
    queryFn: async () => {
      const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';

      tryInitLogging(debugLogging);

      const sdk = await connect({
        config: {
          ...defaultConfig(breezNetwork),
          apiKey,
          lnurlDomain: undefined, // Disables Breez's built-in lightning address recovery — we use our own ln address system
          privateEnabledDefault: true,
          optimizationConfig: {
            autoEnabled: true,
            multiplicity: 2,
          },
        },
        seed: { type: 'mnemonic', mnemonic },
        storageDir,
      });

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
  storageDir: string,
  debugLogging: boolean,
): Promise<{
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
}> {
  try {
    const wallet = await queryClient.fetchQuery(
      sparkWalletQueryOptions({ network, mnemonic, storageDir, debugLogging }),
    );
    const info = await wallet.getInfo({});

    const balance = new Money({
      amount: info.balanceSats,
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
}
