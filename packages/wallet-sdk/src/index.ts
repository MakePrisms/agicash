/**
 * @agicash/wallet-sdk — public entry barrel.
 *
 * This is the package's single public entry (`exports["."]`). It re-exports the public
 * domain TYPES + domain INTERFACES + the `Sdk` class + `SdkConfig` + the event layer +
 * the error classes + the `classify` seam.
 *
 * PR1 shipped the contract (types + interfaces + `declare class Sdk`). PR2 (core) lands
 * the CORE implementation: the real `Money` value export, the runtime error classes +
 * the pure `classify()`, the typed event emitter, and the `Sdk.create` shell with
 * OpenSecret / Supabase / storage wiring. Domain business logic (auth, accounts, scan,
 * cashu, spark, transactions, contacts, transfers, background) is STUBBED until each
 * later slice lands — calling a stubbed method throws `NotImplementedError`.
 */

// --- entry point + config --------------------------------------------------
// `Sdk` is now a real VALUE export (PR2 implemented the class) — `Sdk.create(...)`.
export { Sdk } from './sdk';
export type { SdkConfig } from './config';

// --- value types -----------------------------------------------------------
// `Money` is now a real VALUE export (Slice 0 resolved PR1's placeholder): it
// re-exports the live `Money` class from `app/lib/money` — see ./types/money.
export { Money } from './types/money';
export type { Currency, CurrencyUnit, BtcUnit, UsdUnit } from './types/money';

// --- domain interfaces -----------------------------------------------------
export type {
  AuthDomain,
  UserDomain,
  AccountsDomain,
  ScanDomain,
  CashuDomain,
  CashuSendOps,
  CashuReceiveOps,
  SparkDomain,
  SparkSendOps,
  SparkReceiveOps,
  TransactionsDomain,
  ContactsDomain,
  TransfersDomain,
  ExchangeRateDomain,
  BackgroundDomain,
} from './domains';

// --- events ----------------------------------------------------------------
export type { EventEmitter, SdkEventMap, BackgroundState } from './events';

// --- errors (real classes — values, not just types) ------------------------
export {
  SdkError,
  ConcurrencyError,
  DomainError,
  NotFoundError,
  NotImplementedError,
} from './errors';

// --- error classifier (§12 — pure 4-bucket seam) ---------------------------
export { classify } from './classify';
export type { ErrorClass } from './classify';

// --- accounts (§2) ---------------------------------------------------------
export type {
  Account,
  AccountType,
  AccountState,
  AccountPurpose,
  CashuProof,
  ExtendedAccount,
  CashuAccount,
  SparkAccount,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
  RedactedAccount,
  RedactedCashuAccount,
} from './types/account';
export type {
  AddAccountConfig,
  AccountSuggestion,
} from './types/account-config';

// --- scan (§3) -------------------------------------------------------------
export type { ParsedDestination, PaymentIntent } from './types/scan';

// --- user (§4) -------------------------------------------------------------
export type { User, FullUser, GuestUser } from './types/user';

// --- cashu (§5) ------------------------------------------------------------
export type {
  CashuSendQuote,
  CashuSendSwap,
  PendingCashuSendSwap,
  CashuReceiveQuote,
  CashuTokenMeltData,
  DestinationDetails,
  ReceiveTokenResult,
} from './types/cashu';

// --- spark (§6) ------------------------------------------------------------
export type { SparkSendQuote, SparkReceiveQuote } from './types/spark';

// --- transactions (§7) -----------------------------------------------------
export type {
  Transaction,
  BaseTransaction,
  TransactionCursor,
  TransactionDirection,
  TransactionType,
  TransactionState,
  TransactionPurpose,
} from './types/transaction';
export type {
  TransactionDetails,
  CashuTokenSendTransactionDetails,
  CashuTokenReceiveTransactionDetails,
  CashuLightningSendTransactionDetails,
  IncompleteCashuLightningSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  CashuLightningReceiveTransactionDetails,
  SparkLightningSendTransactionDetails,
  IncompleteSparkLightningSendTransactionDetails,
  CompletedSparkLightningSendTransactionDetails,
  SparkLightningReceiveTransactionDetails,
  IncompleteSparkLightningReceiveTransactionDetails,
  CompletedSparkLightningReceiveTransactionDetails,
} from './types/transaction-details';

// --- contacts (§8) ---------------------------------------------------------
export type { Contact, UserProfile } from './types/contact';

// --- transfers (§9) --------------------------------------------------------
export type {
  TransferQuote,
  TransferLeg,
  TransferResult,
} from './types/transfer';

// --- type-dependency placeholders (PR1) ------------------------------------
// Re-exported so consumers/contract reviewers can see the deferred seams.
// Each is wired to its real source in a later slice — see ./dependencies.
export type {
  StorageAdapter,
  Bolt11Invoice,
  ParsedToken,
  SparkNetwork,
} from './types/dependencies';
