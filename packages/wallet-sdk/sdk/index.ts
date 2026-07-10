// Public contract of @agicash/wallet-sdk, one file per namespace. Prose
// contract: docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md
//
// The entity types the namespaces expose are public projections of the domain
// entities: `userId`/`ownerId` are implicit from the session; raw wallet
// handles and proof material stay internal.
import type { SparkNetwork } from '../db/json-models/spark-account-details-db-data';
import type { AccountsApi } from './accounts';
import type { AuthApi, AuthStorage } from './auth';
import type { BackgroundApi } from './background';
import type { ContactsApi } from './contacts';
import type { WalletEvents } from './events';
import type { FeatureFlagsApi } from './feature-flags';
import type { ReceiveApi } from './receive';
import type { SendApi } from './send';
import type { TransactionsApi } from './transactions';
import type { TransferApi } from './transfer';
import type { UserApi } from './user';

export * from './accounts';
export * from './auth';
export * from './background';
export * from './contacts';
export * from './events';
export * from './feature-flags';
export * from './receive';
export * from './send';
export * from './server';
export * from './transactions';
export * from './transfer';
export * from './user';

/** Diagnostic sink; the SDK never writes to the console directly. */
export type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

export type SdkConfig = {
  db: {
    url: string;
    anonKey: string;
  };
  auth: {
    apiUrl: string;
    clientId: string;
    storage: AuthStorage;
    /**
     * Host override for guest credential generation; resolve null to use the
     * SDK's CSPRNG generator. Test seam (the web bridges its e2e password
     * mock through it).
     */
    generateGuestPassword?: () => Promise<string | null>;
  };
  spark: {
    breezApiKey: string;
    /** Default for account creation; the persisted per-account value is authoritative. */
    network: SparkNetwork;
    /** Node hosts; browser default applies. */
    storageDir?: string;
  };
  /** lud16 domain. */
  lightningAddressDomain: string;
  logger?: Logger;
};

export type Sdk = {
  readonly auth: AuthApi;
  readonly user: UserApi;
  readonly accounts: AccountsApi;
  readonly contacts: ContactsApi;
  readonly transactions: TransactionsApi;
  readonly receive: ReceiveApi;
  readonly send: SendApi;
  readonly transfer: TransferApi;
  readonly featureFlags: FeatureFlagsApi;
  readonly events: WalletEvents;
  readonly background: BackgroundApi;
  /**
   * Front-loads session restore and the Breez WASM load. Resolves when no
   * session exists (a state, not a failure); rejects on actual failures,
   * e.g. `WebAssemblyUnavailableError`. Required before any Spark operation —
   * the SDK does not lazy-load the WASM, so Spark calls without a completed
   * `init()` throw a typed `SdkError`. Non-Spark usage lazy-initializes on
   * first use.
   *
   * Migration note: until the first Spark slice lands, `init()` performs
   * session restore only — the WASM load still runs host-side.
   */
  init(): Promise<void>;
  /**
   * Awaits in-flight background transitions to their next checkpoint, then
   * tears down realtime + background; still-pending namespace promises reject
   * with a typed `SdkError`.
   */
  dispose(): Promise<void>;
};

/** `create` is sync; no I/O. */
export type SdkConstructor = {
  create(config: SdkConfig): Sdk;
};
