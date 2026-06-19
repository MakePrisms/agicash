// The single SDK configuration point: collapses the previously scattered
// configure calls (opensecret, agicash-db, spark, operation measurer) into one
// env-derived WalletSdkConfig. Evaluated on both server and client (configure
// only records state; connections are lazy). Must NOT import feature modules
// that call getSdk() (e.g. feature-flags) — they import this module, so the
// reverse import would cycle.
import {
  WalletSdk,
  browserStorage,
  configureWalletSdk,
} from '@agicash/wallet-sdk/sdk';
import * as Sentry from '@sentry/react-router';
import { sessionHintCookie } from '~/features/user/session-hint-cookie';
import { measureOperation } from '~/lib/performance';
import { cashuMintValidator } from './cashu';

const openSecretApiUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
if (!openSecretApiUrl) {
  throw new Error('VITE_OPEN_SECRET_API_URL is not set');
}

const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
if (!openSecretClientId) {
  throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
}

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

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not set');
}

const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY ?? '';
if (!breezApiKey) {
  throw new Error('VITE_BREEZ_API_KEY is not set');
}

configureWalletSdk({
  openSecret: {
    apiUrl: openSecretApiUrl,
    clientId: openSecretClientId,
    // window access is lazy (getters), so this is safe to pass during the
    // server-side configure() that records config for SSR/prerender.
    storage: browserStorage,
  },
  supabase: {
    url: getSupabaseUrl(),
    anonKey: supabaseAnonKey,
  },
  breez: {
    apiKey: breezApiKey,
  },
  sparkStorageDir: './.spark-data',
  // Matches the root loader's `domain` (new URL(origin).host) for same-origin
  // pages; only invoked client-side after getSdk().
  getLightningAddressDomain: () => window.location.host,
  cashuMintValidator,
  measureOperation,
  captureException: (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  },
  // We want to set the Sentry user id as soon as possible so that events are
  // associated with the user even before the auth user fetch completes.
  onAuthUserIdDecoded: (userId) => {
    Sentry.setUser({ id: userId });
  },
  onAuthStateResolved: (state) => {
    if (state.isLoggedIn) {
      Sentry.setUser({ id: state.user.id, isGuest: !state.user.email });
      // Mirror auth state into a hint cookie so the server can short-circuit
      // SSR for unauthenticated visits. Lifetime matches the refresh token
      // so we don't leave a stale "logged in" hint after the session
      // genuinely expires.
      sessionHintCookie.set(
        state.refreshTokenExpiresAt - Math.floor(Date.now() / 1000),
      );
    } else {
      if (state.reason === 'fetch-failed') {
        Sentry.setUser(null);
      }
      sessionHintCookie.clear();
    }
  },
});

/**
 * The wallet SDK singleton, for use outside React — loaders, actions,
 * query/mutation functions, plain (non-hook) functions, and module scope.
 * Inside a component or hook prefer {@link useSdk}: capture it once at the top
 * and use that instance everywhere in the hook, including its handlers and
 * effects (you can't call a hook inside those, but you can use a captured one).
 */
export const getSdk = (): WalletSdk => WalletSdk.getInstance();

/**
 * The preferred way to reach the wallet SDK inside React. Call it at the top of
 * a component or hook and use the returned instance throughout — including in
 * its event handlers and effects (capture it; don't call this hook inside
 * them). Only non-React code — loaders, actions, query/mutation functions,
 * plain functions, and module scope — should reach for {@link getSdk} directly.
 *
 * Client-only: the SDK binds to browser connections and the browser
 * QueryClient, and every SDK-consuming route renders client-side (the public,
 * prerendered pages never reach the SDK during render). Touching it during
 * SSR/prerender is a bug, so this throws there rather than silently
 * constructing a server-side instance — the guard that previously lived in the
 * framework-agnostic `getSdk()`.
 */
export function useSdk(): WalletSdk {
  if (typeof window === 'undefined') {
    throw new Error(
      'useSdk is client-only. Use getSdk() outside of React render (loaders, query/mutation functions, module scope).',
    );
  }
  // Returns the process singleton directly. If we ever want injectable-for-tests
  // DI, this is the seam to turn into a real context provider (mounted at the
  // app root) — call sites that already use useSdk() wouldn't change.
  return getSdk();
}
