/**
 * SDK configuration — §1 of the contract.
 *
 * The SDK OWNS the Supabase client — the consumer never gets a handle, only
 * provides these params (decision 1). `storage` is the pluggable adapter
 * (web = browser, mcp = fs/sqlite). `clientId` is the leader-election instance id
 * (auto-generated if omitted) — distinct from `openSecret.clientId`.
 */
import type { StorageAdapter } from './types/dependencies';

/**
 * Configuration passed to {@link Sdk.create}. The consumer supplies connection
 * params and a storage adapter; the SDK constructs and owns the underlying
 * Supabase / OpenSecret / Breez clients (the consumer never gets a handle).
 */
export type SdkConfig = {
  /** OpenSecret enclave/auth backend (VITE_OPEN_SECRET_API_URL + _CLIENT_ID). */
  openSecret: {
    /** Base URL of the OpenSecret API. */
    url: string;
    /** OpenSecret client/app id. */
    clientId: string;
  };
  /**
   * Supabase DB + realtime connection. Schema is pinned to `wallet`; the access
   * token used is the OpenSecret JWT (so reads/writes are RLS-scoped to the
   * user). `serviceRoleKey` is only supplied when the SDK runs server-side.
   */
  supabase: {
    /** Supabase project URL. */
    url: string;
    /** Supabase anon (public) key. */
    anonKey: string;
    /** Service-role key — server-side use only; omit in the browser. */
    serviceRoleKey?: string;
  };
  /** API key for the Spark/Breez SDK (required for spark accounts). */
  breezApiKey?: string;
  /**
   * The Agicash deployment's Lightning-address domain (e.g. `agicash.me`). Used to compute a
   * contact's `lud16` as `` `${username}@${domain}` `` (§8) and as the optional LNURL-pay
   * `requestDomain` amount-validation bypass. Re-housed off master's `useLocationData().domain`;
   * defaults to an empty string (contacts' `lud16` then has an empty host) when omitted.
   */
  domain?: string;
  /** Pluggable @agicash/opensecret-sdk storage (web = browser, mcp = fs/sqlite). */
  storage: StorageAdapter;
  /**
   * Leader-election INSTANCE id for background processing; auto-generated if
   * omitted. Distinct from `openSecret.clientId`.
   */
  clientId?: string;
};
