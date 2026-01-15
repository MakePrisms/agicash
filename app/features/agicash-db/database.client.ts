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

const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!supabasePublishableKey) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is not set');
}

/**
 * The client-side Supabase database client.
 * Cannot be used on the server. Use `agicashDbServer` instead.
 */
export const agicashDbClient = createClient<Database>(
  supabaseUrl,
  supabasePublishableKey,
  {
    accessToken: getSupabaseSessionToken,
    db: {
      schema: 'wallet',
    },
    realtime: {
      logger: (kind: string, msg: unknown, data?: unknown) => {
        const now = Date.now();
        console.debug(
          `Realtime -> ${kind}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`,
          {
            timestamp: now,
            time: new Date(now).toISOString(),
            data,
          },
        );
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
