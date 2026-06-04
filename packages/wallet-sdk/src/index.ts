/**
 * @agicash/wallet-sdk — public entry barrel (PR2: core + reactive runtime).
 *
 * TanStack stays HIDDEN inside the SDK behind the lib-agnostic Query<T> contract.
 * PR2 turns PR1's `declare class` shells into real implementations: the error
 * classes, the classify() fn, the event emitter, the Sdk.create factory + the
 * QueryClient-backed reactive runtime. Domain business logic is STUBBED until
 * each later slice lands.
 */

// ---- Core reactive types ----
export type { Query, QueryState } from './types/query';

// ---- Value types ----
export type { Money, Currency } from './types/money';

// ---- Error classes + classifier (real VALUES in PR2) ----
export {
  SdkError,
  ConcurrencyError,
  DomainError,
  NotFoundError,
  NotImplementedError,
} from './errors';
export { classify } from './classify';
export type { ErrorClass } from './classify';

// ---- Events ----
export type {
  SdkEventMap,
  EventEmitter,
  BackgroundState,
} from './types/events';

// ---- Domain types ----
export type {
  AccountType,
  AccountState,
  AccountPurpose,
  SparkNetwork,
  ProofDleq,
  ProofWitness,
  CashuProof,
  ExtendedCashuWallet,
  BreezSdk,
  Account,
  ExtendedAccount,
  CashuAccount,
  SparkAccount,
  RedactedAccount,
  AddAccountConfig,
} from './types/account';

export type { User, UserProfile } from './types/user';

export type {
  Bolt11Invoice,
  ParsedToken,
  ParsedDestination,
  PaymentIntent,
} from './types/scan';

export type {
  DestinationDetails,
  CashuSendQuote,
  CashuSendSwap,
  CashuTokenMeltData,
  CashuReceiveQuote,
  ReceiveTokenResult,
} from './types/cashu';

export type { SparkSendQuote, SparkReceiveQuote } from './types/spark';

export type {
  TransactionDirection,
  TransactionType,
  TransactionState,
  TransactionPurpose,
  TransactionDetails,
  CashuTokenSendTransactionDetails,
  CashuTokenReceiveTransactionDetails,
  IncompleteCashuLightningSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  CashuLightningSendTransactionDetails,
  CashuLightningReceiveTransactionDetails,
  IncompleteSparkLightningSendTransactionDetails,
  CompletedSparkLightningSendTransactionDetails,
  SparkLightningSendTransactionDetails,
  IncompleteSparkLightningReceiveTransactionDetails,
  CompletedSparkLightningReceiveTransactionDetails,
  SparkLightningReceiveTransactionDetails,
  BaseTransaction,
  Transaction,
  TransactionCursor,
} from './types/transaction';

export type { Contact } from './types/contact';
export type { Destination } from './types/destination';

export type {
  TransferReceiveSide,
  TransferSendSide,
  TransferQuote,
  TransferResult,
} from './types/transfer';

// ---- Domain interfaces ----
export type {
  AccountSuggestion,
  SignInParams,
  SignUpParams,
  ChangePasswordParams,
  UpgradeGuestParams,
  CompleteOAuthParams,
  AccountsDomain,
  ScanDomain,
  AuthDomain,
  UserDomain,
  CashuSendOps,
  CashuReceiveOps,
  CashuDomain,
  SparkSendOps,
  SparkReceiveOps,
  SparkDomain,
  TransactionsDomain,
  ContactsDomain,
  TransfersDomain,
  BackgroundDomain,
  ExchangeRateDomain,
} from './domains';

// ---- Sdk class + config (real VALUE in PR2) ----
export type { StorageAdapter, SdkConfig } from './sdk';
export { Sdk } from './sdk';

// ---- Pure helpers ----
export { cashAppDeepLink } from './helpers';
