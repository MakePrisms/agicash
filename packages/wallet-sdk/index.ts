// @agicash/wallet-sdk — public surface: domain types only.
// Repositories, services, and the wallet DB layer are SDK-internal; during the
// migration they're re-exported from '@agicash/wallet-sdk/temporary' instead,
// so that deleting /temporary at the end compiler-enforces the boundary.
export type { DestinationDetails } from './lib/send-destination';
export type { SparkNetwork } from './db/json-models/spark-account-details-db-data';
export type { FeatureFlag, FeatureFlags } from './lib/feature-flag-service';
export type {
  AccountType,
  AccountState,
  AccountPurpose,
  Account,
  ExtendedAccount,
  CashuAccount,
  SparkAccount,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
  RedactedAccount,
  RedactedCashuAccount,
} from './domain/accounts/account';
export type { CashuProof } from './domain/accounts/cashu-account';
export type {
  FullUser,
  GuestUser,
  User,
  UserProfile,
} from './domain/user/user';
export type { Contact } from './domain/contacts/contact';
export type {
  TransactionDirection,
  TransactionType,
  TransactionState,
  TransactionPurpose,
} from './domain/transactions/transaction-enums';
export type { Transaction } from './domain/transactions/transaction';
export type { CashuLightningReceiveTransactionDetails } from './domain/transactions/transaction-details/cashu-lightning-receive-transaction-details';
export type {
  IncompleteCashuLightningSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  CashuLightningSendTransactionDetails,
} from './domain/transactions/transaction-details/cashu-lightning-send-transaction-details';
export type { CashuTokenReceiveTransactionDetails } from './domain/transactions/transaction-details/cashu-token-receive-transaction-details';
export type { CashuTokenSendTransactionDetails } from './domain/transactions/transaction-details/cashu-token-send-transaction-details';
export type {
  IncompleteSparkLightningReceiveTransactionDetails,
  CompletedSparkLightningReceiveTransactionDetails,
  SparkLightningReceiveTransactionDetails,
} from './domain/transactions/transaction-details/spark-lightning-receive-transaction-details';
export type {
  IncompleteSparkLightningSendTransactionDetails,
  CompletedSparkLightningSendTransactionDetails,
  SparkLightningSendTransactionDetails,
} from './domain/transactions/transaction-details/spark-lightning-send-transaction-details';
export type { TransactionDetails } from './domain/transactions/transaction-details/transaction-details-types';
export type { CashuTokenMeltData } from './domain/receive/cashu-token-melt-data';
export type { SparkReceiveQuote } from './domain/receive/spark-receive-quote';
export type {
  SparkReceiveLightningQuote,
  GetLightningQuoteParams,
  CreateQuoteBaseParams,
} from './domain/receive/spark-receive-quote-core';
export type { CashuReceiveQuote } from './domain/receive/cashu-receive-quote';
export type { CashuReceiveLightningQuote } from './domain/receive/cashu-receive-quote-core';
export type { CashuReceiveSwap } from './domain/receive/cashu-receive-swap';
export type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from './domain/receive/receive-cashu-token-models';
export type { CrossAccountReceiveQuotesResult } from './domain/receive/receive-cashu-token-quote-service';
export type {
  GiftCardConfig,
  GiftCardInfo,
} from './domain/gift-cards/gift-card-config';
export { GiftCardConfigSchema } from './domain/gift-cards/gift-card-config';
export { getDefaultUnit } from './lib/currencies';
export type { CashuSendQuote } from './domain/send/cashu-send-quote';
export type {
  GetCashuLightningQuoteOptions,
  CashuLightningQuote,
  SendQuoteRequest,
} from './domain/send/cashu-send-quote-service';
export type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from './domain/send/cashu-send-swap';
export type { CashuSwapQuote } from './domain/send/cashu-send-swap-service';
export type { SparkSendQuote } from './domain/send/spark-send-quote';
export type { SparkLightningQuote } from './domain/send/spark-send-quote-service';
export type { SendDestination } from './domain/send/resolve-destination';
export type { ValidateResult } from './domain/send/validation';
export type {
  TransferReceiveSide,
  TransferSendSide,
  TransferQuote,
} from './domain/transfer/transfer-service';
