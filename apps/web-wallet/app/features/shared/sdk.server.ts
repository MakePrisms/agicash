import {
  type SdkConfig,
  type ServerSdk,
  type StorageProvider,
  createServer,
} from '@agicash/wallet-sdk';

/**
 * A no-op in-memory StorageProvider. Server mode (`createServer`) never reads
 * `storage` (it builds no OpenSecret client), but `SdkConfig.storage` is
 * type-required and `browserStorage` touches `window` (absent server-side).
 */
function createMemoryStorageProvider(): StorageProvider {
  const makeStore = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
  };
  return { persistent: makeStore(), session: makeStore() };
}

/** The server-relevant VITE env vars (read directly so Vite can inline them, server-side too). */
export type ServerSdkEnv = {
  VITE_OPEN_SECRET_API_URL?: string;
  VITE_OPEN_SECRET_CLIENT_ID?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_BREEZ_API_KEY?: string;
};

function readServerEnv(): ServerSdkEnv {
  return {
    VITE_OPEN_SECRET_API_URL: import.meta.env.VITE_OPEN_SECRET_API_URL,
    VITE_OPEN_SECRET_CLIENT_ID: import.meta.env.VITE_OPEN_SECRET_CLIENT_ID,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_BREEZ_API_KEY: import.meta.env.VITE_BREEZ_API_KEY,
  };
}

/**
 * Assemble the server-mode SdkConfig. Public Supabase/OpenSecret params come
 * from import.meta.env (Vite inlines them server-side too); the server secrets
 * (`serviceRoleKey`, `serverSparkMnemonic`) come from process.env and MUST never
 * reach the browser bundle (this is a `.server.ts`). `env`/`processEnv` are
 * injectable for testing.
 */
export function buildServerSdkConfig({
  lud16Domain,
  env = readServerEnv(),
  processEnv = process.env,
}: {
  lud16Domain: string;
  env?: ServerSdkEnv;
  processEnv?: Record<string, string | undefined>;
}): SdkConfig {
  return {
    openSecret: {
      url: env.VITE_OPEN_SECRET_API_URL ?? '',
      clientId: env.VITE_OPEN_SECRET_CLIENT_ID ?? '',
    },
    supabase: {
      url: env.VITE_SUPABASE_URL ?? '',
      anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
      serviceRoleKey: processEnv.SUPABASE_SERVICE_ROLE_KEY,
    },
    breezApiKey: env.VITE_BREEZ_API_KEY,
    sparkStorageDir: '/tmp/.spark-data',
    storage: createMemoryStorageProvider(),
    lud16Domain,
    serverSparkMnemonic: processEnv.LNURL_SERVER_SPARK_MNEMONIC,
  };
}

let serverSdk: ServerSdk | undefined;

/**
 * The process-singleton server-mode SDK (warm Breez wallet reused across
 * requests). Memoized on the first call's `lud16Domain` (stable per origin in
 * prod). Consumed by the Lightning-Address routes in S14.
 */
export function getServerSdk(lud16Domain: string): ServerSdk {
  if (!serverSdk) {
    serverSdk = createServer(buildServerSdkConfig({ lud16Domain }));
  }
  return serverSdk;
}
