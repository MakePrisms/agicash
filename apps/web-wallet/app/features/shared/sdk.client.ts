import { browserStorage } from '@agicash/opensecret';
import { AgicashSdk } from '@agicash/wallet-sdk';
import { breezApiKey } from '~/lib/breez';

const getSupabaseUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }

  if (
    supabaseUrl.includes('127.0.0.1') &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    (window.location.hostname.endsWith('.local') ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname))
  ) {
    return supabaseUrl.replace('127.0.0.1', window.location.hostname);
  }

  return supabaseUrl;
};

export const supabaseUrl = getSupabaseUrl();

export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not set');
}

const openSecretApiUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
if (!openSecretApiUrl) {
  throw new Error('VITE_OPEN_SECRET_API_URL is not set');
}

const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
if (!openSecretClientId) {
  throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
}

// console.debug(message, undefined) prints a trailing "undefined". Most calls
// pass no meta, so the second argument is omitted unless meta is provided.
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

const createSdk = () =>
  AgicashSdk.create({
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

// Instance-per-identity: the SDK binds to one identity for its lifetime, so this
// is a live binding, not a const. Consumers read `sdk` at call time and pick up
// the replacement that rebuildSdk installs.
export let sdk = createSdk();

/**
 * Disposes the current SDK instance and installs a fresh one. Called on a
 * session end (sign-out, expiry, or a different-user transition) so the next
 * identity authenticates on an unused instance — the SDK refuses a second
 * identity on an instance that already established one.
 */
export const rebuildSdk = async (): Promise<void> => {
  await sdk.dispose();
  sdk = createSdk();
};

if (import.meta.hot) {
  // A hot reload of this module constructs a second SDK; dispose the old one
  // so its expiry timer doesn't leak. Returning the promise makes Vite await
  // the teardown before evaluating the replacement module.
  import.meta.hot.dispose(() => sdk.dispose());
}
