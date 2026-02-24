import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Anon-only Supabase client. No access token, no auth context.
 * Use for operations that must work before the user has authenticated
 */
export const agicashDbAnon = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  { db: { schema: 'wallet' } },
);
