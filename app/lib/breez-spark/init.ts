let wasmInitialized = false;

// Variable indirection prevents tsx/Vite from statically analyzing the import
// path during SSR module resolution, which breaks on the WASM package.
const BREEZ_SDK_MODULE = '@breeztech/breez-sdk-spark/bundler';

async function getBreezSdk() {
  return import(/* @vite-ignore */ BREEZ_SDK_MODULE);
}

/**
 * Idempotent WASM initialization. Must be called before any other Breez SDK usage.
 * Uses dynamic import — the WASM module only works in the browser.
 */
export async function initBreezWasm(): Promise<void> {
  if (wasmInitialized) return;
  const { default: initBreezSDK } = await getBreezSdk();
  await initBreezSDK();
  wasmInitialized = true;
}

function getBreezApiKey(): string {
  const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('VITE_BREEZ_API_KEY is not set. Add it to your .env file.');
  }
  return apiKey;
}

/**
 * Connects to the Breez SDK and returns a BreezSdk instance.
 * Automatically initializes WASM if not already done.
 *
 * @param mnemonic - BIP39 mnemonic phrase for wallet derivation
 */
export async function connectBreezWallet(mnemonic: string) {
  await initBreezWasm();

  const { connect, defaultConfig } = await getBreezSdk();

  const config = {
    ...defaultConfig('mainnet'),
    apiKey: getBreezApiKey(),
  };

  return connect({
    config,
    seed: { type: 'mnemonic' as const, mnemonic },
    storageDir: 'breez-spark-wallet',
  });
}
