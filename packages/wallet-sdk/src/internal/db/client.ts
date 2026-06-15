import { createClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { AgicashDb, Database } from './database';

/** Constructs the Supabase client the SDK owns. Schema is fixed to `wallet`.
 * In client mode the access token is supplied lazily by the SessionTokenProvider;
 * a serviceRoleKey (server mode) authenticates directly and skips the provider. */
export function createAgicashDb(
  config: SdkConfig['supabase'],
  getAccessToken: () => Promise<string | null>,
): AgicashDb {
  const key = config.serviceRoleKey ?? config.anonKey;
  return createClient<Database>(config.url, key, {
    ...(config.serviceRoleKey
      ? {}
      : { accessToken: async () => (await getAccessToken()) ?? key }),
    db: { schema: 'wallet' },
  });
}
