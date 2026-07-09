import { browserStorage } from '@agicash/opensecret';
import { AgicashSdk } from '@agicash/wallet-sdk';
import {
  supabaseAnonKey,
  supabaseUrl,
} from '~/features/agicash-db/database.client';
import { breezApiKey } from '~/lib/breez';

const openSecretApiUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
if (!openSecretApiUrl) {
  throw new Error('VITE_OPEN_SECRET_API_URL is not set');
}

const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
if (!openSecretClientId) {
  throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
}

const consoleLogger = {
  debug: (message: string, meta?: unknown) =>
    meta === undefined ? console.debug(message) : console.debug(message, meta),
  info: (message: string, meta?: unknown) =>
    meta === undefined ? console.info(message) : console.info(message, meta),
  warn: (message: string, meta?: unknown) =>
    meta === undefined ? console.warn(message) : console.warn(message, meta),
  error: (message: string, meta?: unknown) =>
    meta === undefined ? console.error(message) : console.error(message, meta),
};

export const sdk = AgicashSdk.create({
  db: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  },
  auth: {
    apiUrl: openSecretApiUrl,
    clientId: openSecretClientId,
    storage: browserStorage,
    // e2e bridge: the Playwright fixture arms window.getMockPassword; in
    // production it's absent, so this resolves null and the SDK generates.
    generateGuestPassword: async () =>
      (await window.getMockPassword?.()) ?? null,
  },
  spark: {
    breezApiKey,
    network: 'MAINNET',
  },
  lightningAddressDomain: window.location.host,
  logger: consoleLogger,
});

if (import.meta.hot) {
  // A hot reload of this module constructs a second SDK; dispose the old one
  // so its expiry timer doesn't leak.
  import.meta.hot.dispose(() => void sdk.dispose());
}
