import {
  type StatelessSdk,
  createStatelessSdk,
} from '@agicash/wallet-sdk/stateless';
import { MintBlocklistSchema } from '~/lib/cashu';
import {
  browserLocalStorageAdapter,
  browserSessionStorageAdapter,
} from './storage-adapter';

/** Inlined copy of `database.client.ts`'s `getSupabaseUrl()`. Browser-only: it
 * reads `window.location` to rewrite `127.0.0.1` to the LAN host when the app is
 * served over HTTPS from a `.local`/private-range hostname (so a phone on the
 * same network can reach the local Supabase). Called only from `initSdk()`, which
 * runs client-side, so the `window` access never executes during SSR. The SDK is
 * host-agnostic and passes this URL straight to `createClient` without re-rewriting. */
function getSupabaseUrl(): string {
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
}

let sdkPromise: Promise<StatelessSdk> | undefined;
let sdkInstance: StatelessSdk | undefined;

/**
 * Construct the module-singleton SDK (idempotent). The first call assembles the
 * config from the app's `VITE_*` env and the `domain` from the root loader, then
 * holds the in-flight promise so concurrent callers share one construction.
 * Subsequent calls return the same promise/instance.
 * @param domain LN-address domain for contact composition (the root loader's
 *   canonical-origin host).
 */
export function initSdk(domain: string): Promise<StatelessSdk> {
  if (!sdkPromise) {
    const openSecretUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
    if (!openSecretUrl) {
      throw new Error('VITE_OPEN_SECRET_API_URL is not set');
    }
    const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
    if (!openSecretClientId) {
      throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
    }
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
    if (!supabaseAnonKey) {
      throw new Error('VITE_SUPABASE_ANON_KEY is not set');
    }
    const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY;
    if (!breezApiKey) {
      throw new Error('VITE_BREEZ_API_KEY is not set');
    }

    sdkPromise = createStatelessSdk({
      openSecret: { url: openSecretUrl, clientId: openSecretClientId },
      supabase: { url: getSupabaseUrl(), anonKey: supabaseAnonKey },
      storage: browserLocalStorageAdapter,
      sessionStorage: browserSessionStorageAdapter,
      breezApiKey,
      domain,
      includeTestAccounts: import.meta.env.MODE === 'development',
      cashuMintBlocklist: MintBlocklistSchema.parse(
        JSON.parse(import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]'),
      ),
    }).then((sdk) => {
      sdkInstance = sdk;
      return sdk;
    });
  }
  return sdkPromise;
}

/**
 * The resolved SDK singleton.
 * @throws if {@link initSdk} has not resolved yet.
 */
export function getSdk(): StatelessSdk {
  if (!sdkInstance) {
    throw new Error('SDK not initialised — call initSdk() first');
  }
  return sdkInstance;
}

/** Dispose the SDK and clear the singleton so the next sign-in re-initialises. */
export async function disposeSdk(): Promise<void> {
  const sdk = sdkInstance;
  sdkInstance = undefined;
  sdkPromise = undefined;
  await sdk?.dispose();
}
