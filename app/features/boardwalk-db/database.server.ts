import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

export const boardwalkDbServiceRole = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    db: {
      schema: 'wallet',
    },
  },
);
