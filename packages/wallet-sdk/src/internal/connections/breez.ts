import initWasm, {
  type BreezSdk,
  type Network,
  connect,
  defaultConfig,
  defaultExternalSigner,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';

export class WebAssemblyUnavailableError extends Error {
  constructor() {
    super('WebAssembly is not available in this browser session');
    this.name = 'WebAssemblyUnavailableError';
  }
}

let wasmInitPromise: Promise<unknown> | null = null;

/**
 * Initializes the Breez SDK WASM module exactly once, even across concurrent
 * callers. The SDK's own init only short-circuits after completion, so parallel
 * calls mid-init would each run a full fetch/compile/__wbindgen_start. Caching
 * the promise here makes the second caller await the same in-flight init.
 *
 * If `WebAssembly` is not exposed by the runtime, rejects with
 * `WebAssemblyUnavailableError` before invoking any wasm-bindgen code.
 */
export function initBreezWasm(): Promise<unknown> {
  if (typeof WebAssembly === 'undefined') {
    return Promise.reject(new WebAssemblyUnavailableError());
  }
  wasmInitPromise ??= initWasm();
  return wasmInitPromise;
}

// Breez's initLogging delegates to Rust's tracing crate, which enforces a
// single global subscriber per process — calling it twice always errors. Track
// status so we only attempt init once, regardless of outcome.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;

/**
 * Attempts to initialize Breez SDK logging exactly once per module lifetime.
 * Subsequent calls are no-ops regardless of whether the first attempt succeeded
 * or failed — Rust's tracing crate only accepts a single global subscriber and
 * errors on a second registration.
 */
export function tryInitLogging(debug: boolean): void {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({
    log(e) {
      if (debug) console.debug('[breez]', e);
    },
  })
    .then(() => {
      loggingStatus = 'initialized';
    })
    .catch(() => {
      loggingStatus = 'failed';
    });
}

export type BreezConnectConfig = {
  apiKey: string;
  network: 'mainnet' | 'regtest';
  storageDir: string;
  debugLogging?: boolean;
};

/**
 * Connects to the Breez Spark SDK with the given config and mnemonic seed.
 * Initializes logging (guarded; at most one attempt per module lifetime) and
 * builds a `ConnectRequest` that mirrors the web-wallet's connect call.
 *
 * @param cfg - Connection configuration including API key, network, and storage dir.
 * @param mnemonic - BIP39 mnemonic for the Spark wallet seed.
 * @returns The connected `BreezSdk` instance.
 */
export async function connectBreez(
  cfg: BreezConnectConfig,
  mnemonic: string,
): Promise<BreezSdk> {
  tryInitLogging(cfg.debugLogging ?? false);

  return connect({
    config: {
      ...defaultConfig(cfg.network),
      apiKey: cfg.apiKey,
      // lnurlDomain omitted (undefined) — disables Breez's built-in lightning
      // address recovery; caller uses its own ln address system.
      lnurlDomain: undefined,
      privateEnabledDefault: true,
      optimizationConfig: {
        autoEnabled: true,
        multiplicity: 2,
      },
    },
    seed: { type: 'mnemonic', mnemonic },
    storageDir: cfg.storageDir,
  });
}

/**
 * Derives the Spark identity public key (hex) for a BIP39 mnemonic. Initializes
 * the Breez WASM module first (the signer is WASM-backed); `identityPublicKey()`
 * itself is a synchronous, network-free key derivation — NO `connect()` needed.
 *
 * @param mnemonic - The Spark wallet BIP39 mnemonic (BIP-85 child).
 * @param network - Breez network (`'mainnet'` | `'regtest'`).
 * @returns The identity public key as a lowercase hex string.
 */
export async function getSparkIdentityPublicKey(
  mnemonic: string,
  network: Network,
): Promise<string> {
  await initBreezWasm();
  const signer = defaultExternalSigner(mnemonic, null, network);
  return bytesToHex(new Uint8Array(signer.identityPublicKey().bytes));
}
