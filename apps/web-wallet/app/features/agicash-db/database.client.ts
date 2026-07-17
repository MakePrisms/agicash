import type { Database } from '@agicash/wallet-sdk/temporary';
import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '~/features/shared/sdk.client';
import { SupabaseRealtimeManager } from '~/lib/supabase';
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
