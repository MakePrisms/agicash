/**
 * SDK configuration — §1 of the contract.
 *
 * The SDK OWNS the Supabase client — the consumer never gets a handle, only
 * provides these params (decision 1). `storage` is the pluggable adapter
 * (web = browser, mcp = fs/sqlite). `clientId` is the leader-election instance id
 * (auto-generated if omitted) — distinct from `openSecret.clientId`.
 */
import type { StorageProvider } from '@agicash/opensecret';
import type { MintBlocklist } from './internal/lib/cashu/mint-validation';
import type { AccountPurpose } from './types/account';
import type { SparkNetwork } from './types/dependencies';
import type { Currency } from './types/money';

/**
 * A default account created during user-row bootstrap (the consumer supplies the
 * set; the SDK reads no environment). Mirrors the web's `defaultAccounts`: at
 * least one BTC Spark account is required. Mapped to the DB `account_input`
 * composite by the bootstrap.
 */
export type DefaultAccountConfig =
  | {
      type: 'spark';
      currency: 'BTC';
      name: string;
      network: SparkNetwork;
      purpose: AccountPurpose;
      isDefault: boolean;
    }
  | {
      type: 'cashu';
      currency: Currency;
      name: string;
      mintUrl: string;
      isTestMint: boolean;
      purpose: AccountPurpose;
      isDefault: boolean;
    };

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
  /** Storage directory for the Spark/Breez SDK (default `./.spark-data`; server uses `/tmp/.spark-data`). */
  sparkStorageDir?: string;
  /** Enable verbose Breez SDK logging (maps the web's `DEBUG_LOGGING_SPARK` flag). */
  debugLoggingSpark?: boolean;
  /**
   * Allow `localhost` Lightning addresses when parsing scanned input (dev only;
   * replaces the web's `import.meta.env.MODE === 'development'`). Default false.
   */
  allowLocalhostLightningAddress?: boolean;
  /**
   * Pluggable OpenSecret storage provider (`{ persistent, session }`). Browser
   * passes the exported `browserStorage`; MCP/Node implements it over fs/sqlite.
   */
  storage: StorageProvider;
  /**
   * Accounts created at first sign-in (user-row bootstrap). The consumer owns the
   * set (the web gates dev test-mints via `import.meta.env` when assembling this).
   * Required for client mode; bootstrap throws if it lacks a BTC Spark account.
   */
  defaultAccounts?: DefaultAccountConfig[];
  /**
   * Cashu mints (or mint+unit pairs) to block; fed into `cashuMintValidator`.
   * Parse the consumer's env JSON with `MintBlocklistSchema` before passing.
   * Default `[]`.
   */
  cashuMintBlocklist?: MintBlocklist;
  /**
   * Leader-election INSTANCE id for background processing; auto-generated if
   * omitted. Distinct from `openSecret.clientId`.
   */
  clientId?: string;
};
