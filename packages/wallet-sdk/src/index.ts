/**
 * @agicash/wallet-sdk — the package's single public entry (`exports["."]`).
 *
 * Re-exports the public domain types + domain interfaces + the `Sdk` class +
 * `SdkConfig` + the event layer + the error classes. Implementation lands
 * incrementally per migration slice: `auth` + `user` are live (S3); the other
 * domains are stubbed (`NotImplementedError`) until their slices implement them.
 */

// --- entry point + config --------------------------------------------------
export { Sdk } from './sdk';
export type { SdkConfig, DefaultAccountConfig } from './config';

// --- server-mode entry point ----------------------------------------------
export { createServer, ServerSdk } from './server-sdk';
export type {
  ServerSdkApi,
  LnurlVerifyRef,
  LightningAddressReceiveInfo,
  LightningReceiveQuoteResult,
  LightningReceiveStatusResult,
} from './server-sdk';

// --- value types -----------------------------------------------------------
// `Money` is a real class re-exported from the shared @agicash/money package, so
// `instanceof` holds across the SDK↔web boundary (see ./types/money).
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
export { classify } from './internal/classify';

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

// --- accounts value helpers (pure; consumed by the thin web read-model) ------
export {
  getAccountBalance,
  getExtendedAccounts,
  isDefaultAccount,
  canSendToLightning,
  canReceiveFromLightning,
} from './domains/accounts/account-utils';

// --- scan (§3) -------------------------------------------------------------
export type { ParsedDestination, PaymentIntent } from './types/scan';

// --- exchange rate (§6 delta) -----------------------------------------------
export type { Ticker, Rates } from './types/exchange-rate';

// --- user (§4) -------------------------------------------------------------
export type { User, FullUser, GuestUser } from './types/user';

// --- cashu (§5) ------------------------------------------------------------
export type {
  CashuSendQuote,
  CashuSendSwap,
  PendingCashuSendSwap,
  CashuReceiveQuote,
  CashuReceiveSwap,
  CashuTokenMeltData,
  DestinationDetails,
} from './types/cashu';
export type { CashuLightningQuote } from './domains/cashu/cashu-send-quote-service';

// --- cashu mint blocklist (config helper) ----------------------------------
// Re-exported so the consumer can Zod-parse its env JSON before assembling
// `SdkConfig.cashuMintBlocklist` (the SdkConfig JSDoc points the consumer here).
export { MintBlocklistSchema } from './internal/lib/cashu/mint-validation';
export type { MintBlocklist } from './internal/lib/cashu/mint-validation';

// --- spark (§6) ------------------------------------------------------------
export type { SparkSendQuote, SparkReceiveQuote } from './types/spark';
export type { SparkLightningQuote } from './domains/spark/spark-send-quote-service';

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
  Bolt11Invoice,
  ParsedToken,
  SparkNetwork,
} from './types/dependencies';
export type { StorageProvider } from '@agicash/opensecret';
