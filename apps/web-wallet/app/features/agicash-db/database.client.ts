import type { Database } from '@agicash/wallet-sdk/temporary';
import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '~/features/shared/sdk.client';
import { getSupabaseSessionToken } from './supabase-session';

/**
 * The client-side Supabase database client.
 * If you need to use a client on the server, which bypasses RLS, use `agicashDbServer` instead.
 */
export const agicashDbClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    accessToken: getSupabaseSessionToken,
    db: {
      schema: 'wallet',
    },
  },
);
