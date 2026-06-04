import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
if (!supabaseSecretKey) {
  throw new Error('SUPABASE_SECRET_KEY is not set');
}

/**
 * The server-side Supabase database client.
 * Cannot be used on the client. Use `agicashDbClient` instead.
 */
export const agicashDbServer = createClient<Database>(
  supabaseUrl,
  supabaseSecretKey,
  {
    db: {
      schema: 'wallet',
    },
  },
);
