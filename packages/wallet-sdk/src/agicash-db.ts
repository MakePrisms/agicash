import type { Database } from '@agicash/db-types';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseSessionToken } from './supabase-session';

/**
 * Creates the RLS-scoped Agicash Supabase client: schema pinned to `wallet`,
 * authenticated via the OpenSecret-derived session token, with the production
 * payload-redacting realtime logger.
 *
 * The consumer supplies the connection params (the web app reads them from its
 * Vite env); the SDK owns the client construction.
 */
export const createAgicashDb = ({
  url,
  anonKey,
}: {
  url: string;
  anonKey: string;
}) =>
  createClient<Database>(url, anonKey, {
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
  });
