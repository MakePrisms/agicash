import { createClient } from '@supabase/supabase-js';
import type { AgicashDb, Database } from './database';

type AgicashDbClientConfig = {
  url: string;
  anonKey: string;
  /** Resolves the Supabase session JWT; null selects the anon key. */
  accessToken: () => Promise<string | null>;
};

/** Builds the SDK's own Supabase client (wallet schema). */
export function createAgicashDbClient(
  config: AgicashDbClientConfig,
): AgicashDb {
  return createClient<Database>(config.url, config.anonKey, {
    accessToken: config.accessToken,
    db: {
      schema: 'wallet',
    },
  });
}
