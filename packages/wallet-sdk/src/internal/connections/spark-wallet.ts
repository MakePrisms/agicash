import type { BreezSdk } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkNetwork } from '../../types/dependencies';

/** A BreezSdk Proxy whose every method throws — used when Spark is offline. */
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

/** A connected (or offline-stubbed) spark wallet plus its current balance. */
export type InitializedSparkWallet = {
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
};

/**
 * Owns the live Breez/Spark connection(s). Connects ONCE per network
 * (single-flight; a failed connect is not cached so the next call retries),
 * replacing the web's TanStack `spark-wallet` query memo. On any failure returns
 * an offline stub + null balance (mirrors master's `getInitializedSparkWallet`).
 * The balance LISTENER (re-read on `synced`) is NOT here — it is S7.
 */
export class SparkWalletService {
  private readonly connections = new Map<SparkNetwork, Promise<BreezSdk>>();

  constructor(
    private readonly connect: (network: SparkNetwork) => Promise<BreezSdk>,
  ) {}

  async getInitialized(network: SparkNetwork): Promise<InitializedSparkWallet> {
    try {
      const wallet = await this.connectOnce(network);
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

  private connectOnce(network: SparkNetwork): Promise<BreezSdk> {
    const existing = this.connections.get(network);
    if (existing) return existing;
    const promise = this.connect(network);
    promise.catch(() => this.connections.delete(network));
    this.connections.set(network, promise);
    return promise;
  }
}
