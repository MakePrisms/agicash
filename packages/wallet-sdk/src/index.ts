// @agicash/wallet-sdk — reactive contract (design B)
// TanStack is hidden behind Query<T>; reads return Query<T>, derivations are sync, writes return Promise.

// ---- Core reactive types ----
export type { Query, QueryState } from './types/query';

// ---- Value types ----
export type { Money, Currency } from './types/money';

// ---- Error classes + classifier ----
export {
  SdkError,
  ConcurrencyError,
  DomainError,
  NotFoundError,
  classify,
} from './types/errors';

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

export type {
  TransferLeg,
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

// ---- Sdk class + config ----
export type { StorageAdapter, SdkConfig } from './sdk';
export { Sdk } from './sdk';

// ---- Pure helpers ----
export { cashAppDeepLink } from './helpers';
