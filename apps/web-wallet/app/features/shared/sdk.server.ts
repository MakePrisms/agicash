import { AgicashServerSdk } from '@agicash/wallet-sdk/server';
import { breezApiKey } from '~/lib/breez';

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const quoteEncryptionKey = process.env.LNURL_SERVER_ENCRYPTION_KEY || '';
if (!quoteEncryptionKey) {
  throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

// Vite SSR re-evaluates this module on edit while the cached server-sdk.ts
// keeps its instance slot, and import.meta.hot is undefined under
// ssrLoadModule — dispose the previous instance so create() doesn't throw.
const devHandle = globalThis as { agicashServerSdk?: AgicashServerSdk };
devHandle.agicashServerSdk?.dispose();

export const serverSdk = AgicashServerSdk.create({
  db: {
    url: supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
  },
  spark: {
    breezApiKey,
    network: 'MAINNET',
    mnemonic: sparkMnemonic,
    storageDir: '/tmp/.spark-data',
  },
  quoteEncryptionKey,
});
devHandle.agicashServerSdk = serverSdk;
