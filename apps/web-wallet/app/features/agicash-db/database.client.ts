import { getAgicashDb } from '@agicash/wallet-sdk/agicash-db';
import { SupabaseRealtimeManager } from '~/lib/supabase';
// Configures the SDK (incl. the DB connection) before the client is built.
import '../shared/sdk';

/**
 * The client-side Supabase database client (the SDK-owned instance).
 * Transitional re-export for not-yet-migrated repositories; removed in the
 * import-cleanup PR. If you need a client on the server, which bypasses RLS,
 * use `agicashDbServer` instead.
 */
export const agicashDbClient = getAgicashDb();

/**
 * The client-side Supabase realtime client.
 * Cannot be used on the server.
 */
export const agicashRealtimeClient = new SupabaseRealtimeManager(
  agicashDbClient.realtime,
);
// biome-ignore lint/suspicious/noExplicitAny: attaching to window for debugging
(window as any).agicashRealtime = agicashRealtimeClient;
