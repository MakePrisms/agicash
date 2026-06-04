import { Sdk, type SdkConfig, type StorageAdapter } from '@agicash/wallet-sdk';

/**
 * Browser-side `Sdk` singleton (PR8a).
 *
 * Mirrors the {@link ./query-client} `browserQueryClient` pattern: the app builds ONE
 * `Sdk` instance per browser session and shares it through `AgicashProvider`. `Sdk.create`
 * is async, so initialisation happens client-side in `entry.client.tsx` (the app's `App`
 * root is sync and also runs during SSR — the SDK is browser-only). The promise is memoised
 * here so a re-import never constructs a second instance.
 *
 * The SDK is INSTANTIATED but NOT STARTED in PR8a: the web keeps driving its own TanStack
 * caches, Supabase realtime, and task-processor. `Sdk.create` opens no network connections
 * on its own (OpenSecret `configure` is a module-global no-op; the Supabase client is built
 * but its realtime channel only subscribes on `background.start()`, which PR8a never calls).
 */
let sdkPromise: Promise<Sdk> | undefined;

/** A `localStorage`-backed {@link StorageAdapter} for the browser (the SDK's web storage). */
const browserStorage: StorageAdapter = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    window.localStorage.removeItem(key);
  },
};

/**
 * Build the {@link SdkConfig} from the same `VITE_*` credentials the web app already reads
 * (OpenSecret in `entry.client.tsx`, Supabase in `agicash-db/database.client.ts`, Breez in
 * `features/shared/spark.ts`). Browser-only — uses `window.location.host` for the LN-address
 * domain.
 */
function getSdkConfig(): SdkConfig {
  const openSecretUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
  if (!openSecretUrl) {
    throw new Error('VITE_OPEN_SECRET_API_URL is not set');
  }
  const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
  if (!openSecretClientId) {
    throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  if (!supabaseAnonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is not set');
  }
  const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY ?? '';
  if (!breezApiKey) {
    throw new Error('VITE_BREEZ_API_KEY is not set');
  }

  return {
    openSecret: { url: openSecretUrl, clientId: openSecretClientId },
    supabase: { url: supabaseUrl, anonKey: supabaseAnonKey },
    breezApiKey,
    storage: browserStorage,
    domain: window.location.host,
  };
}

/**
 * Create (once) and return the browser `Sdk` singleton. Safe to call repeatedly — the
 * underlying `Sdk.create` promise is memoised. Call only in the browser.
 *
 * @returns the initialised `Sdk` instance.
 */
export function getSdk(): Promise<Sdk> {
  if (!sdkPromise) {
    sdkPromise = Sdk.create(getSdkConfig());
  }
  return sdkPromise;
}
