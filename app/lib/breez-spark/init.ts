import type { BreezSdk } from '@breeztech/breez-sdk-spark/bundler';

let wasmInitialized = false;

/**
 * Idempotent WASM initialization. Must be called before any other Breez SDK usage.
 * Uses dynamic import — the WASM module only works in the browser.
 */
export async function initBreezWasm(): Promise<void> {
  if (wasmInitialized) return;
  const { default: initBreezSDK } = await import(
    '@breeztech/breez-sdk-spark/bundler'
  );
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
 * @returns A connected BreezSdk instance
 */
export async function connectBreezWallet(mnemonic: string): Promise<BreezSdk> {
  await initBreezWasm();

  const { connect, defaultConfig } = await import(
    '@breeztech/breez-sdk-spark/bundler'
  );

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
