// Sdk class shape + SdkConfig

import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from './domains';
import type { EventEmitter, SdkEventMap } from './types/events';

// ---- StorageAdapter (pluggable — web=browser, mcp=fs/sqlite) ----

export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

// ---- SdkConfig ----

export type SdkConfig = {
  /** Enclave/auth backend (VITE_OPEN_SECRET_API_URL + _CLIENT_ID) */
  openSecret: { url: string; clientId: string };
  /**
   * DB/realtime; schema pinned to 'wallet'.
   * Access token = the OpenSecret JWT (RLS-scoped).
   * SDK OWNS the client — consumer never gets a handle, only provides these params.
   */
  supabase: { url: string; anonKey: string; serviceRoleKey?: string };
  /** Spark/Breez SDK */
  breezApiKey?: string;
  /** Pluggable storage — web = browser, mcp = fs/sqlite */
  storage: StorageAdapter;
  /**
   * SDK leader-election INSTANCE id (auto-generated if omitted).
   * Distinct from openSecret.clientId.
   */
  clientId?: string;
  /**
   * App domain for LN-address composition (Contact.lud16 = `${username}@${domain}`).
   * Defaults to '' — set it for valid LN-address/contact features.
   */
  domain?: string;
};

// ---- Sdk ----

export declare class Sdk {
  static create(config: SdkConfig): Promise<Sdk>;

  readonly auth: AuthDomain;
  readonly user: UserDomain;
  readonly accounts: AccountsDomain;
  readonly cashu: CashuDomain;
  readonly spark: SparkDomain;
  readonly transactions: TransactionsDomain;
  readonly contacts: ContactsDomain;
  readonly transfers: TransfersDomain;
  readonly scan: ScanDomain;
  readonly exchangeRate: ExchangeRateDomain;
  readonly background: BackgroundDomain;
  readonly events: EventEmitter<SdkEventMap>;

  /**
   * Close WS subs (mints + Supabase + Breez), halt orchestrators, clear timers.
   */
  destroy(): Promise<void>;
}
