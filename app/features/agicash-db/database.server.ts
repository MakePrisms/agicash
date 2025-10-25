import { createClient } from '@supabase/supabase-js';
import type { Database as DatabaseGenerated } from 'supabase/database.types';
import type { Database } from './database';

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

type MintsDatabase = Pick<DatabaseGenerated, 'mints'>;

export const agicashDbServiceRole = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    db: {
      schema: 'wallet',
    },
  },
);

export const agicashDbMints = createClient<MintsDatabase>(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    db: {
      schema: 'mints',
    },
  },
);
