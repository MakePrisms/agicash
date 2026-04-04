import initBreezSDK, {
  connect,
  defaultConfig,
} from '@breeztech/breez-sdk-spark';

let wasmInitialized = false;

/**
 * Idempotent WASM initialization. Must be called before any other Breez SDK usage.
 */
export async function initBreezWasm(): Promise<void> {
  if (wasmInitialized) return;
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
