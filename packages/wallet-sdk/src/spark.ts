import {
  type BreezSdk,
  connect,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import type { SparkNetwork } from '@agicash/db-types/json-models/spark-account-details-db-data';
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import { Money } from '@agicash/utils/money';
import { computeSHA256 } from '@agicash/utils/sha256';
import type { QueryClient } from '@tanstack/query-core';
import { getSeedPhraseDerivationPath } from './accounts/account-cryptography';
import { measureOperation } from './performance';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
} from './spark-utils';

type SparkConfig = {
  /** Breez API key (the web app reads it from its Vite env). */
  apiKey: string;
  /** Gate for spark/Breez debug logging; checked per log call. */
  isDebugLoggingEnabled: () => boolean;
};

let sparkConfig: SparkConfig | undefined;

/**
 * Configures the spark/Breez connection. The host app calls this once at
 * startup (the web app does it at module load of its spark feature, supplying
 * the env-derived API key and the feature-flag-gated debug-log check).
 */
export function configureSpark(config: {
  apiKey: string;
  isDebugLoggingEnabled?: () => boolean;
}): void {
  sparkConfig = { isDebugLoggingEnabled: () => false, ...config };
}

function getSparkConfig(): SparkConfig {
  if (!sparkConfig) {
    throw new Error('Spark is not configured. Call configureSpark first.');
  }
  return sparkConfig;
}

export function sparkDebugLog(message: string, data?: Record<string, unknown>) {
  if (sparkConfig?.isDebugLoggingEnabled()) {
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
      if (sparkConfig?.isDebugLoggingEnabled()) {
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

export const sparkMnemonicQueryOptions = () => ({
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
}) => ({
  queryKey: ['spark-identity-public-key'],
  queryFn: async () => {
    const mnemonic = await queryClient.fetchQuery(sparkMnemonicQueryOptions());
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
}: { network: SparkNetwork; mnemonic: string; storageDir: string }) => ({
  queryKey: ['spark-wallet', computeSHA256(mnemonic), network, storageDir],
  queryFn: async () => {
    const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';

    tryInitLogging();

    const sdk = await measureOperation(
      'BreezSdk.connect',
      () =>
        connect({
          config: {
            ...defaultConfig(breezNetwork),
            apiKey: getSparkConfig().apiKey,
            lnurlDomain: undefined, // Disables Breez's built-in lightning address recovery — we use our own ln address system
            privateEnabledDefault: true,
            optimizationConfig: {
              autoEnabled: true,
              multiplicity: 2,
            },
          },
          seed: { type: 'mnemonic', mnemonic },
          storageDir,
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
          sparkWalletQueryOptions({ network, mnemonic, storageDir }),
        );
        const info = await measureOperation('BreezSdk.getInfo', () =>
          wallet.getInfo({}),
        );

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
    },
    { sparkNetwork: network },
  );
}
