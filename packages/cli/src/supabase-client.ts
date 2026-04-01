// packages/cli/src/supabase-client.ts
import { generateThirdPartyToken } from '@agicash/opensecret-sdk';
import type { AgicashDb, Database } from '@agicash/sdk/db/database';
import { createClient } from '@supabase/supabase-js';

type ValidateOk = { ok: true; url: string; anonKey: string };
type ValidateFail = { ok: false; error: string };
type ValidateResult = ValidateOk | ValidateFail;

export function validateSupabaseEnv(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ValidateResult {
  const url = env.SUPABASE_URL;
  if (!url) {
    return {
      ok: false,
      error: 'SUPABASE_URL is required in .env for cloud sync',
    };
  }
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    return {
      ok: false,
      error: 'SUPABASE_ANON_KEY is required in .env for cloud sync',
    };
  }
  return { ok: true, url, anonKey };
}

let cachedClient: AgicashDb | null = null;

/**
 * Returns a Supabase client authenticated via OpenSecret's third-party JWT.
 * Requires OpenSecret to be configured and the user to be logged in.
 * The `accessToken` callback calls `generateThirdPartyToken()` on each request,
 * which handles token refresh automatically via the SDK.
 */
export function getSupabaseClient(): AgicashDb {
  if (cachedClient) return cachedClient;

  const env = validateSupabaseEnv();
  if (!env.ok) {
    throw new Error(env.error);
  }

  cachedClient = createClient<Database>(env.url, env.anonKey, {
    accessToken: async () => {
      const response = await generateThirdPartyToken();
      return response.token;
    },
    db: { schema: 'wallet' },
  });

  return cachedClient;
}
