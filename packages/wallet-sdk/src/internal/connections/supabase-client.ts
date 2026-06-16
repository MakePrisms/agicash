import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { Database } from '../db/database';

/**
 * Browser-mode Supabase client: anon key + an async access-token provider
 * (the OpenSecret JWT), schema pinned to `wallet`. The SDK owns this client.
 */
export function createBrowserClient(
  config: SdkConfig,
  getAccessToken: () => Promise<string | null>,
): SupabaseClient<Database> {
  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    accessToken: getAccessToken,
    db: { schema: 'wallet' },
  });
}

/** Server-mode Supabase client: service-role key (RLS bypass), no session. */
export function createServerClient(
  config: SdkConfig,
): SupabaseClient<Database> {
  if (!config.supabase.serviceRoleKey) {
    throw new Error('createServerClient requires supabase.serviceRoleKey');
  }
  return createClient<Database>(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    { db: { schema: 'wallet' } },
  );
}
