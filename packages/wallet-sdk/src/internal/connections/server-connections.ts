import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { Database } from '../db/database';
import { connectBreez } from './breez';
import type { CashuWalletService } from './cashu-wallet';
import { buildCashuWalletService } from './index';
import { SparkWalletService } from './spark-wallet';
import { createServerClient } from './supabase-client';

/** The narrow server-mode connection bundle (no OpenSecret, no per-user keys, no realtime). */
export type ServerConnections = {
  supabase: SupabaseClient<Database>;
  sparkWallets: SparkWalletService;
  cashuWallets: CashuWalletService;
};

/**
 * Assembles the server-mode connections: a service-role Supabase client, a
 * dedicated server Spark wallet (own mnemonic + storageDir), and seedless cashu
 * mint clients. Throws if `serviceRoleKey` or `serverSparkMnemonic` is missing.
 */
export function buildServerConnections(config: SdkConfig): ServerConnections {
  const supabase = createServerClient(config); // throws if serviceRoleKey missing
  const serverSparkMnemonic = config.serverSparkMnemonic;
  if (!serverSparkMnemonic) {
    throw new Error('createServer requires config.serverSparkMnemonic');
  }

  const sparkWallets = new SparkWalletService((network) =>
    connectBreez(
      {
        apiKey: config.breezApiKey ?? '',
        network: network.toLowerCase() as 'mainnet' | 'regtest',
        storageDir: config.sparkStorageDir ?? '/tmp/.spark-data',
        debugLogging: config.debugLoggingSpark ?? false,
      },
      serverSparkMnemonic,
    ),
  );

  const cashuWallets = buildCashuWalletService();

  return { supabase, sparkWallets, cashuWallets };
}
