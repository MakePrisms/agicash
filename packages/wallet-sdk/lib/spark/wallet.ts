import {
  type BreezSdk,
  connect,
  defaultConfig,
  defaultExternalSigner,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import { computeSHA256 } from '@agicash/utils';
import { bytesToHex } from '@noble/hashes/utils';
import type { SparkNetwork } from '../../db/json-models/spark-account-details-db-data';
import { getSeedPhraseDerivationPath } from '../cryptography';

/** Host-provided Spark/Breez configuration. */
export type SparkWalletConfig = {
  /** Local directory where Breez persists wallet state. */
  storageDir: string;
  /** Breez SDK API key. */
  apiKey: string;
};

/**
 * Gets the Spark identity public key from a mnemonic using the Breez SDK signer.
 * @param mnemonic - BIP39 mnemonic phrase.
 * @param network - The Breez SDK network ('mainnet' or 'regtest').
 * @returns Hex-encoded compressed public key.
 */
export function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: 'mainnet' | 'regtest',
): string {
  const signer = defaultExternalSigner(mnemonic, null, network);
  const publicKey = signer.identityPublicKey();
  return bytesToHex(new Uint8Array(publicKey.bytes));
}

export function createSparkWalletStub(reason: string): BreezSdk {
  return new Proxy({} as BreezSdk, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return () => {
          console.error(`Cannot call ${prop} on Spark wallet stub`);
          throw new Error(reason);
        };
      }
      return undefined;
    },
  });
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

function tryInitLogging() {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({
    // initLogging must run once to satisfy Breez's single-subscriber
    // constraint, but the headless SDK has no feature-flag access to gate
    // per-line debug output, so the log sink is intentionally a no-op.
    log() {
      return;
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

/**
 * Reads the Spark BIP39 mnemonic from Open Secret.
 * Network leaf: the caller memoizes (the web wraps this in its TanStack cache).
 */
export const getSparkMnemonic = async (): Promise<string> => {
  const response = await getMnemonic({
    seed_phrase_derivation_path: seedDerivationPath,
  });
  return response.mnemonic;
};

const sparkWalletPromises = new Map<string, Promise<BreezSdk>>();

/**
 * Returns the process-wide Breez wallet for a mnemonic, connecting on first
 * request and memoizing the connection. A Breez `connect()` opens a stateful
 * session, so it must run at most once per mnemonic/network/storageDir —
 * re-connecting would leak duplicate sessions. A failed connect is evicted so
 * the next call retries.
 */
export function getSparkWallet({
  network,
  mnemonic,
  storageDir,
  apiKey,
}: {
  network: SparkNetwork;
  mnemonic: string;
  storageDir: string;
  apiKey: string;
}): Promise<BreezSdk> {
  const key = `${computeSHA256(mnemonic)}:${network}:${storageDir}`;
  const existing = sparkWalletPromises.get(key);
  if (existing) return existing;

  const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';
  tryInitLogging();
  const walletPromise = connect({
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
  sparkWalletPromises.set(key, walletPromise);
  walletPromise.catch(() => {
    sparkWalletPromises.delete(key);
  });
  return walletPromise;
}

/**
 * Drops all memoized Breez wallet connections so a subsequent session
 * reconnects fresh. Called on sign-out.
 */
export function clearSparkWallets(): void {
  sparkWalletPromises.clear();
}

/**
 * Initializes a Spark wallet with offline handling.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * @param mnemonic - The Spark wallet mnemonic.
 * @param network - The Spark network that the wallet is on.
 * @returns The wallet, balance and online status.
 */
export async function getInitializedSparkWallet(
  mnemonic: string,
  network: SparkNetwork,
  config: SparkWalletConfig,
): Promise<{
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
}> {
  try {
    const wallet = await getSparkWallet({
      network,
      mnemonic,
      storageDir: config.storageDir,
      apiKey: config.apiKey,
    });
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
