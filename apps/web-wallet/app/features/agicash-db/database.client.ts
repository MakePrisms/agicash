import { createClient } from '@supabase/supabase-js';
import { SupabaseRealtimeManager } from '~/lib/supabase';
import type { Database } from './database';
import { getSupabaseSessionToken } from './supabase-session';

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
export const agicashDbClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    accessToken: getSupabaseSessionToken,
    db: {
      schema: 'wallet',
    },
    realtime: {
      logger: (kind: string, msg: string, data?: unknown) => {
        const now = Date.now();
        const logData: Record<string, unknown> = {
          timestamp: now,
          time: new Date(now).toISOString(),
          data,
        };
        if (
          process.env.NODE_ENV === 'production' &&
          kind === 'receive' &&
          typeof logData.data === 'object' &&
          logData.data != null &&
          'payload' in logData.data
        ) {
          // We don't want this to log the app data for receive messages in production.
          logData.data = {
            ...logData.data,
            payload: '<redacted>',
          };
        }
        console.debug(`Realtime ${kind}: ${msg}`, logData);
      },
      logLevel: 'info',
    },
  },
);

/**
 * The client-side Supabase realtime client.
 * Cannot be used on the server.
 */
export const agicashRealtimeClient = new SupabaseRealtimeManager(
  agicashDbClient.realtime,
);
// biome-ignore lint/suspicious/noExplicitAny: attaching to window for debugging
(window as any).agicashRealtime = agicashRealtimeClient;
