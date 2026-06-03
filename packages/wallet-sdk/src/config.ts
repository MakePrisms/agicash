/**
 * SDK configuration — §1 of the contract.
 *
 * The SDK OWNS the Supabase client — the consumer never gets a handle, only
 * provides these params (decision 1). `storage` is the pluggable adapter
 * (web = browser, mcp = fs/sqlite). `clientId` is the leader-election instance id
 * (auto-generated if omitted) — distinct from `openSecret.clientId`.
 */
import type { StorageAdapter } from './types/dependencies';

export type SdkConfig = {
  /** enclave/auth backend (VITE_OPEN_SECRET_API_URL + _CLIENT_ID) */
  openSecret: { url: string; clientId: string };
  /**
   * db/realtime; schema pinned to 'wallet'; access token = the OpenSecret JWT
   * (RLS-scoped). `serviceRoleKey` only if the SDK runs server-side.
   */
  supabase: { url: string; anonKey: string; serviceRoleKey?: string };
  /** Spark/Breez SDK */
  breezApiKey?: string;
  /** @agicash/opensecret-sdk pluggable storage (web=browser, mcp=fs/sqlite) */
  storage: StorageAdapter;
  /** leader-election INSTANCE id (auto-generated if omitted) */
  clientId?: string;
};
