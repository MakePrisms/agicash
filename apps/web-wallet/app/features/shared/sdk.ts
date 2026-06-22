import { browserStorage } from '@agicash/opensecret';
import {
  type DefaultAccountConfig,
  type MintBlocklist,
  MintBlocklistSchema,
  Sdk,
  type SdkConfig,
} from '@agicash/wallet-sdk';

/** The client-relevant env vars (each read directly so Vite can statically inline it). */
export type ClientSdkEnv = {
  VITE_OPEN_SECRET_API_URL?: string;
  VITE_OPEN_SECRET_CLIENT_ID?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_BREEZ_API_KEY?: string;
  VITE_CASHU_MINT_BLOCKLIST?: string;
  MODE?: string;
};

function readClientEnv(): ClientSdkEnv {
  return {
    VITE_OPEN_SECRET_API_URL: import.meta.env.VITE_OPEN_SECRET_API_URL,
    VITE_OPEN_SECRET_CLIENT_ID: import.meta.env.VITE_OPEN_SECRET_CLIENT_ID,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_BREEZ_API_KEY: import.meta.env.VITE_BREEZ_API_KEY,
    VITE_CASHU_MINT_BLOCKLIST: import.meta.env.VITE_CASHU_MINT_BLOCKLIST,
    MODE: import.meta.env.MODE,
  };
}

function parseMintBlocklist(raw: string | undefined): MintBlocklist {
  return MintBlocklistSchema.parse(JSON.parse(raw ?? '[]'));
}

function buildDefaultAccounts(isDevelopment: boolean): DefaultAccountConfig[] {
  const accounts: DefaultAccountConfig[] = [
    {
      type: 'spark',
      currency: 'BTC',
      name: 'Bitcoin',
      network: 'MAINNET',
      isDefault: true,
      purpose: 'transactional',
    },
  ];
  if (isDevelopment) {
    accounts.push(
      {
        type: 'cashu',
        currency: 'BTC',
        name: 'Testnut BTC',
        mintUrl: 'https://testnut.cashu.space',
        isTestMint: true,
        isDefault: false,
        purpose: 'transactional',
      },
      {
        type: 'cashu',
        currency: 'USD',
        name: 'Testnut USD',
        mintUrl: 'https://testnut.cashu.space',
        isTestMint: true,
        isDefault: true,
        purpose: 'transactional',
      },
    );
  }
  return accounts;
}

/**
 * Assemble the client-mode SdkConfig from the browser env. `lud16Domain` is
 * supplied by the caller (the web derives it from the root loader's canonical
 * origin host — it is NOT an env var). `env` is injectable for testing.
 */
export function buildClientSdkConfig({
  lud16Domain,
  env = readClientEnv(),
}: {
  lud16Domain: string;
  env?: ClientSdkEnv;
}): SdkConfig {
  const isDevelopment = env.MODE === 'development';
  if (!env.VITE_OPEN_SECRET_API_URL) {
    throw new Error('VITE_OPEN_SECRET_API_URL is not set');
  }
  if (!env.VITE_OPEN_SECRET_CLIENT_ID) {
    throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
  }
  if (!env.VITE_SUPABASE_URL) throw new Error('VITE_SUPABASE_URL is not set');
  if (!env.VITE_SUPABASE_ANON_KEY)
    throw new Error('VITE_SUPABASE_ANON_KEY is not set');
  return {
    openSecret: {
      url: env.VITE_OPEN_SECRET_API_URL,
      clientId: env.VITE_OPEN_SECRET_CLIENT_ID,
    },
    supabase: {
      url: env.VITE_SUPABASE_URL,
      anonKey: env.VITE_SUPABASE_ANON_KEY,
    },
    breezApiKey: env.VITE_BREEZ_API_KEY,
    sparkStorageDir: './.spark-data',
    allowLocalhostLightningAddress: isDevelopment,
    storage: browserStorage,
    defaultAccounts: buildDefaultAccounts(isDevelopment),
    cashuMintBlocklist: parseMintBlocklist(env.VITE_CASHU_MINT_BLOCKLIST),
    lud16Domain,
  };
}

let clientSdk: Promise<Sdk> | undefined;

/**
 * The browser-singleton SDK. Caches the `Promise<Sdk>` (not the resolved
 * instance) so a React-suspense re-render doesn't construct a second client
 * (which would re-run OpenSecret `configure()` and rebuild connections).
 * `lud16Domain` is read on the first call (stable per session); later calls
 * return the cached promise.
 */
export function getSdk(lud16Domain: string): Promise<Sdk> {
  if (!clientSdk) {
    clientSdk = Sdk.create(buildClientSdkConfig({ lud16Domain }));
  }
  return clientSdk;
}
