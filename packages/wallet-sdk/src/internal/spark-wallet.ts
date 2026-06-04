/**
 * Internal spark (Breez) wallet initialiser — Slice 3 (cashu + spark).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/shared/spark.ts#getInitializedSparkWallet` (+
 * `sparkWalletQueryOptions` / `tryInitLogging`) and the stub from
 * `app/lib/spark/utils.ts#createSparkWalletStub`. Builds a spark account's LIVE handle: a
 * `BreezSdk` connection (from the account's seed mnemonic + network) and its balance (from
 * `getInfo().balanceSats`). If Breez is unreachable / errors it returns a throwing stub with
 * `isOnline: false` + `null` balance, exactly as master.
 *
 * **`@agicash/breez-sdk-spark` is a native/WASM package** (loads WASM + auto-enables Node
 * storage at module-eval, `engines.node >= 22`). To keep it OUT of the unit-test path — and
 * off any code path that does not actually open a spark wallet — its runtime API
 * (`connect` / `defaultConfig` / `initLogging`) is loaded via a **dynamic `import()`** inside
 * {@link getInitializedSparkWallet}; the `BreezSdk` / `SdkEvent` TYPES are imported
 * type-only (erased, no WASM). Tests mock by passing a `connect` injection — the real module
 * is never imported. CI never needs Breez credentials or network: a spark wallet is only
 * constructed when an account is actually resolved with a real `breezApiKey`.
 *
 * Re-housing vs master:
 *  - The `QueryClient` memo (`sparkWalletQueryOptions`, `staleTime: Infinity`) → a
 *    framework-free per-(mnemonic,network) memo held by the resolver, so an account's wallet
 *    is connected once. `measureOperation` telemetry is dropped (§3).
 *  - `apiKey` (master `import.meta.env.VITE_BREEZ_API_KEY`) comes from `SdkConfig.breezApiKey`.
 *  - The `getFeatureFlag('DEBUG_LOGGING_SPARK')` debug gate is dropped (no feature-flag
 *    subsystem in the SDK); logging is initialised quietly, once.
 *
 * @module
 */
import type { BreezSdk } from '@agicash/breez-sdk-spark';
import { computeSHA256 } from './crypto';
import { Money } from '../types/money';
import type { SparkNetwork } from '../types/account';

/**
 * The subset of `@agicash/breez-sdk-spark`'s runtime API this module uses, typed from the
 * real package (type-only import — erased, no WASM load) so the dynamically-loaded native
 * module and any test mock are checked against the genuine `connect` / `defaultConfig` /
 * `initLogging` signatures.
 */
export type BreezRuntime = Pick<
  typeof import('@agicash/breez-sdk-spark'),
  'connect' | 'defaultConfig' | 'initLogging'
>;

/**
 * Lazily load the native Breez runtime exactly once. Kept behind a dynamic `import()` so the
 * WASM module is only pulled when a spark wallet is actually connected (never in unit tests,
 * which inject a mock {@link BreezRuntime}).
 */
let breezRuntimePromise: Promise<BreezRuntime> | null = null;
function loadBreezRuntime(): Promise<BreezRuntime> {
  breezRuntimePromise ??= import('@agicash/breez-sdk-spark').then((m) => ({
    connect: m.connect,
    defaultConfig: m.defaultConfig,
    initLogging: m.initLogging,
  }));
  return breezRuntimePromise;
}

// Breez's initLogging delegates to Rust's tracing crate (a single global subscriber per
// process — a second call always errors). Track status so we attempt it at most once,
// regardless of outcome. Mirrors master's `loggingStatus` guard.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;
function tryInitLogging(runtime: BreezRuntime): void {
  if (loggingStatus !== undefined || !runtime.initLogging) {
    return;
  }
  loggingStatus = 'initializing';
  runtime
    .initLogging({
      log() {
        // Discard Breez log lines: the SDK has no feature-flag debug gate (master's was
        // `getFeatureFlag('DEBUG_LOGGING_SPARK')`); this no-op logger just satisfies the API.
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

/**
 * A throwing stand-in for a spark wallet that could not be connected (offline / error).
 * Every method call throws `reason`. Ported from `lib/spark/utils.ts#createSparkWalletStub`,
 * re-implemented inline so the stub carries NO dependency on the native Breez package.
 *
 * @param reason - the message every stubbed method throws.
 * @returns a `BreezSdk`-typed proxy whose every method throws.
 */
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

type ConnectedWallet = { wallet: BreezSdk; balance: Money };

type SparkCacheEntry = {
  network: SparkNetwork;
  value: Promise<ConnectedWallet>;
};

/**
 * Per-(mnemonic, network) memo of connected spark wallets — the framework-free stand-in for
 * master's `sparkWalletQueryOptions` (`staleTime/gcTime: Infinity`). The cache key hashes the
 * mnemonic (never stores it in plaintext). A connect that rejects is not cached (the next
 * call retries → a transient outage does not pin an offline result). Held by the resolver;
 * dropped on `Sdk.destroy()`.
 */
export class SparkWalletCache {
  private readonly entries = new Map<string, SparkCacheEntry>();

  /** Connect (or return memoised) the wallet+balance for `(mnemonic, network)`. */
  async getConnected(params: {
    runtime: BreezRuntime;
    mnemonic: string;
    network: SparkNetwork;
    storageDir: string;
    apiKey: string;
  }): Promise<ConnectedWallet> {
    const key = `${await computeSHA256(params.mnemonic)}:${params.network}:${params.storageDir}`;
    const existing = this.entries.get(key);
    if (existing) {
      return existing.value;
    }
    const value = this.connect(params);
    this.entries.set(key, { network: params.network, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) {
        this.entries.delete(key);
      }
    });
    return value;
  }

  /** Drop all memoised wallets (called when the resolver / SDK is torn down). */
  clear(): void {
    this.entries.clear();
  }

  private async connect({
    runtime,
    mnemonic,
    network,
    storageDir,
    apiKey,
  }: {
    runtime: BreezRuntime;
    mnemonic: string;
    network: SparkNetwork;
    storageDir: string;
    apiKey: string;
  }): Promise<ConnectedWallet> {
    const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';
    tryInitLogging(runtime);

    const wallet = await runtime.connect({
      config: {
        ...runtime.defaultConfig(breezNetwork),
        apiKey,
        // Disable Breez's built-in lightning-address recovery — agicash uses its own
        // ln-address system (master sets `lnurlDomain: undefined`).
        lnurlDomain: undefined,
        privateEnabledDefault: true,
        optimizationConfig: { autoEnabled: true, multiplicity: 2 },
      },
      seed: { type: 'mnemonic', mnemonic },
      storageDir,
    });
    const info = await wallet.getInfo({});
    // `as Money` (the unparameterised form) matches master `shared/spark.ts`; a `Money<'BTC'>`
    // is not assignable to the `Money<Currency>` the resolver returns.
    const balance = new Money({
      amount: info.balanceSats,
      currency: 'BTC',
      unit: 'sat',
    }) as Money;
    return { wallet, balance };
  }
}

/**
 * Initialise a spark wallet with offline handling, mirroring master
 * `getInitializedSparkWallet`. Connects (memoised) a `BreezSdk` for the account's mnemonic +
 * network and reads its balance; on any failure returns a throwing stub with `isOnline:
 * false` + `null` balance.
 *
 * @param params.cache - the per-(mnemonic,network) wallet memo (held by the resolver).
 * @param params.mnemonic - the account's seed mnemonic.
 * @param params.network - the spark network.
 * @param params.storageDir - the Breez storage directory.
 * @param params.apiKey - the Breez API key (`SdkConfig.breezApiKey`).
 * @param params.runtime - optional Breez-runtime injection (tests pass a mock; defaults to
 *   the dynamically-imported native module).
 * @returns the live wallet (or stub), balance, and whether spark was reachable.
 */
export async function getInitializedSparkWallet({
  cache,
  mnemonic,
  network,
  storageDir,
  apiKey,
  runtime,
}: {
  cache: SparkWalletCache;
  mnemonic: string;
  network: SparkNetwork;
  storageDir: string;
  apiKey: string;
  runtime?: BreezRuntime;
}): Promise<{ wallet: BreezSdk; balance: Money | null; isOnline: boolean }> {
  try {
    const resolvedRuntime = runtime ?? (await loadBreezRuntime());
    const { wallet, balance } = await cache.getConnected({
      runtime: resolvedRuntime,
      mnemonic,
      network,
      storageDir,
      apiKey,
    });
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
