function getBreezApiKey(): string {
  const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('VITE_BREEZ_API_KEY is not set. Add it to your .env file.');
  }
  return apiKey;
}

let loggingInitialized = false;

async function ensureLogging() {
  if (loggingInitialized) return;
  const { initLogging } = await import('@breeztech/breez-sdk-spark');
  try {
    await initLogging(
      { log: (entry) => console.log(`[Breez ${entry.level}] ${entry.line}`) },
      'info',
    );
    loggingInitialized = true;
  } catch {
    // Already initialized in this session
    loggingInitialized = true;
  }
}

/**
 * Connects to the Breez SDK and returns a BreezSdk instance.
 * WASM must be initialized first (done in entry.client.tsx).
 *
 * @param mnemonic - BIP39 mnemonic phrase for wallet derivation
 */
export async function connectBreezWallet(mnemonic: string) {
  await ensureLogging();
  const { connect, defaultConfig } = await import('@breeztech/breez-sdk-spark');

  const config = {
    ...defaultConfig('mainnet'),
    apiKey: getBreezApiKey(),
  };

  return connect({
    config,
    seed: { type: 'mnemonic' as const, mnemonic },
    storageDir: 'breez-spark-wallet-fresh',
  });
}
