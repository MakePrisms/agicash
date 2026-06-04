/**
 * SDK-owned Supabase client construction — §1 / Slice 0 connection wiring.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/agicash-db/database.client.ts`. The master form reads
 * `import.meta.env.VITE_SUPABASE_*`, rewrites `127.0.0.1` against `window.location`, and
 * attaches the realtime client to `window` for debugging. All of that is STRIPPED here:
 * the client is built purely from `SdkConfig.supabase` params + the SDK-internal
 * access-token provider. The SDK OWNS this client; the consumer never gets a handle
 * (decision 1) — it only supplies `{ url, anonKey, serviceRoleKey? }`.
 *
 * - The schema is PINNED to `'wallet'` (every SDK read/write is in that schema).
 * - `accessToken` = the OpenSecret JWT (RLS-scoped) via the injected provider. When
 *   `serviceRoleKey` is supplied (server-side use), the service-role key is used as the
 *   key and RLS is bypassed; no per-request `accessToken` is attached in that mode.
 *
 * The `Database` row/result types (master `agicash-db/database.ts`) are NOT lifted here
 * — PR2 ships the re-housed CLIENT, typed loosely; a later slice narrows the generic to
 * `SupabaseClient<Database>` once those types are lifted into the package.
 *
 * @module
 */
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/** Connection params for the SDK-owned Supabase client (subset of `SdkConfig.supabase`). */
export type SupabaseConnectionConfig = {
  url: string;
  anonKey: string;
  /** Present only when the SDK runs server-side; bypasses RLS. */
  serviceRoleKey?: string;
};

/** The Supabase DB schema every SDK query is pinned to. */
export const WALLET_SCHEMA = 'wallet' as const;

/**
 * The SDK-owned Supabase client, with its schema pinned to {@link WALLET_SCHEMA}. The DB
 * generic is left as the supabase-js default (untyped) until the lifted `Database` types
 * land in a later slice, at which point this becomes `SupabaseClient<Database, 'wallet'>`.
 */
export type WalletSupabaseClient = SupabaseClient<
  // biome-ignore lint/suspicious/noExplicitAny: matches supabase-js's own default DB generic; narrowed to `Database` once those types are lifted.
  any,
  typeof WALLET_SCHEMA,
  typeof WALLET_SCHEMA
>;

/**
 * Build the SDK-owned Supabase client.
 *
 * @param config - the `{ url, anonKey, serviceRoleKey? }` connection params.
 * @param getAccessToken - returns the current OpenSecret JWT for RLS (or `null` when
 *   signed out). Ignored when `serviceRoleKey` is set (service-role bypasses RLS).
 * @returns a configured `SupabaseClient` (schema pinned to `'wallet'`).
 *
 * TODO(later slice): parameterise as `SupabaseClient<Database>` once the lifted DB types
 * land; lift the realtime debug logger from `database.client.ts` if needed.
 */
export function createSupabaseClient(
  config: SupabaseConnectionConfig,
  getAccessToken: () => Promise<string | null>,
): WalletSupabaseClient {
  if (!config.url) {
    throw new Error('SdkConfig.supabase.url is required');
  }
  if (!config.anonKey) {
    throw new Error('SdkConfig.supabase.anonKey is required');
  }

  // Server-side: authenticate with the service-role key (bypasses RLS); no per-request
  // user token is attached.
  if (config.serviceRoleKey) {
    return createClient(config.url, config.serviceRoleKey, {
      db: { schema: WALLET_SCHEMA },
    });
  }

  // Client-side (default): anon key + the RLS-scoping OpenSecret JWT per request.
  return createClient(config.url, config.anonKey, {
    accessToken: getAccessToken,
    db: { schema: WALLET_SCHEMA },
  });
}
