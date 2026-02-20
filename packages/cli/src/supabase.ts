import type { Database } from '@agicash/core/db/database';
import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client authenticated with the seed-auth JWT.
 * Uses the `wallet` schema for all queries (matching the app's behavior).
 */
export function createAgicashDb(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string,
) {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'wallet' },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}
