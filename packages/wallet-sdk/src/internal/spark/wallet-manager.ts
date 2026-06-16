import {
  type BreezSdk,
  connect,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkNetwork } from '../db/json-models/spark-account-details-db-data';
import type { KeyService } from '../keys';
import { createSparkWalletStub } from './stub';

// Breez's initLogging delegates to Rust's tracing crate, which enforces a single
// global subscriber per process — calling it twice always errors. Track status so
// we only attempt init once, regardless of outcome.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;
function tryInitLogging() {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({ log() {} })
    .then(() => {
      loggingStatus = 'initialized';
    })
    .catch((error) => {
      loggingStatus = 'failed';
      console.warn('Failed to initialize Breez SDK logging', error);
    });
}

/**
 * Owns the connected Breez SDK wallet per network — one connect() each, cached as
 * a Promise — replacing the app's sparkWalletQueryOptions singleton. getWallet()
 * mirrors getInitializedSparkWallet (balance via getInfo, offline stub on failure).
 * dispose() disconnects the wallets and clears the cache.
 */
export class SparkWalletManager {
  private readonly wallets = new Map<SparkNetwork, Promise<BreezSdk>>();

  constructor(
    private readonly keys: KeyService,
    private readonly apiKey: string,
    private readonly storageDir: string,
  ) {}

  private connect(network: SparkNetwork): Promise<BreezSdk> {
    let cached = this.wallets.get(network);
    if (!cached) {
      cached = this.keys.getSparkMnemonic().then((mnemonic) => {
        tryInitLogging();
        const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';
        return connect({
          config: {
            ...defaultConfig(breezNetwork),
            apiKey: this.apiKey,
            lnurlDomain: undefined,
            privateEnabledDefault: true,
            optimizationConfig: { autoEnabled: true, multiplicity: 2 },
          },
          seed: { type: 'mnemonic', mnemonic },
          storageDir: this.storageDir,
        });
      });
      // A failed connect() must not poison the cache — evict the rejected promise
      // so a later getWallet retries. (A getInfo() failure on an already-connected
      // wallet is handled in getWallet and deliberately keeps the wallet cached.)
      cached.catch(() => {
        if (this.wallets.get(network) === cached) {
          this.wallets.delete(network);
        }
      });
      this.wallets.set(network, cached);
    }
    return cached;
  }

  async getWallet(network: SparkNetwork): Promise<{
    wallet: BreezSdk;
    balance: Money | null;
    isOnline: boolean;
  }> {
    try {
      const wallet = await this.connect(network);
      const info = await wallet.getInfo({});
      const balance = new Money({
        amount: info.balanceSats,
        currency: 'BTC',
        unit: 'sat',
      }) as Money;
      return { wallet, balance, isOnline: true };
    } catch (error) {
      // connect() self-evicts on failure (so a retry reconnects); a getInfo()
      // failure leaves the still-valid connection cached and just reports offline
      // for this call — matching the app, and avoiding a leaked connection.
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

  async dispose(): Promise<void> {
    const wallets = [...this.wallets.values()];
    this.wallets.clear();
    await Promise.allSettled(
      wallets.map(async (p) => {
        const wallet = await p;
        await wallet.disconnect();
      }),
    );
  }
}
