const key = import.meta.env.VITE_BREEZ_API_KEY;
if (!key) {
  throw new Error('VITE_BREEZ_API_KEY is not set');
}

/** Breez SDK API key, read from the environment and passed into the wallet SDK. */
export const breezApiKey: string = key;
