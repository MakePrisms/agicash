import { createServerSdk, type ServerSdk } from '@agicash/wallet-sdk/server';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';
import type { Ticker } from '~/lib/exchange-rate/providers/types';

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let instance: Promise<ServerSdk> | undefined;

/** Lazily constructs (and memoizes) the server-mode SDK from server env. */
export function getServerSdk(): Promise<ServerSdk> {
  instance ??= createServerSdk({
    supabase: {
      url: requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
      serviceRoleKey: requireEnv(
        'SUPABASE_SERVICE_ROLE_KEY',
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
    },
    breezApiKey: requireEnv(
      'VITE_BREEZ_API_KEY',
      import.meta.env.VITE_BREEZ_API_KEY,
    ),
    sparkStorageDir: '/tmp/.spark-data',
    lightningAddress: {
      serverSparkMnemonic: requireEnv(
        'LNURL_SERVER_SPARK_MNEMONIC',
        process.env.LNURL_SERVER_SPARK_MNEMONIC,
      ),
      verifyEncryptionKey: requireEnv(
        'LNURL_SERVER_ENCRYPTION_KEY',
        process.env.LNURL_SERVER_ENCRYPTION_KEY,
      ),
    },
    getExchangeRate: (ticker) =>
      new ExchangeRateService().getRate(ticker as Ticker),
  });
  return instance;
}
