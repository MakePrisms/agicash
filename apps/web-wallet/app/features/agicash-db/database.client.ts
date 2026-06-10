import { createAgicashDb } from '@agicash/wallet-sdk/agicash-db';
import { SupabaseRealtimeManager } from '~/lib/supabase';

const getSupabaseUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }

  if (
    supabaseUrl.includes('127.0.0.1') &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    (window.location.hostname.endsWith('.local') ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname))
  ) {
    return supabaseUrl.replace('127.0.0.1', window.location.hostname);
  }

  return supabaseUrl;
};

const supabaseUrl = getSupabaseUrl();

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not set');
}

/**
 * The client-side Supabase database client.
 * If you need to use a client on the server, which bypasses RLS, use `agicashDbServer` instead.
 */
export const agicashDbClient = createAgicashDb({
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
});

/**
 * The client-side Supabase realtime client.
 * Cannot be used on the server.
 */
export const agicashRealtimeClient = new SupabaseRealtimeManager(
  agicashDbClient.realtime,
);
// biome-ignore lint/suspicious/noExplicitAny: attaching to window for debugging
(window as any).agicashRealtime = agicashRealtimeClient;
