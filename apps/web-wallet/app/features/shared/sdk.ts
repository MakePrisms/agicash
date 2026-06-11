// The single SDK configuration point: collapses the previously scattered
// configure calls (opensecret, agicash-db, spark, operation measurer) into one
// env-derived WalletSdkConfig. Evaluated on both server and client (configure
// only records state; connections are lazy). Must NOT import feature modules
// that read from the DB (e.g. feature-flags) — they import database.client,
// which configures through this module.
import { configureWalletSdk } from '@agicash/wallet-sdk/sdk';
import * as Sentry from '@sentry/react-router';
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
});

export { getSdk } from '@agicash/wallet-sdk/sdk';
