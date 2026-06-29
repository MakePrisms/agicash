// @agicash/wallet-sdk — public surface: domain types only.
// Repositories, services, and the wallet DB layer are SDK-internal; during the
// migration they're re-exported from '@agicash/wallet-sdk/temporary' instead,
// so that deleting /temporary at the end compiler-enforces the boundary.
export type { DestinationDetails } from './shared/send-destination';
export type { SparkNetwork } from './agicash-db/json-models/spark-account-details-db-data';
export type { FeatureFlag, FeatureFlags } from './shared/feature-flag-service';
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
} from './accounts/account';
export type { CashuProof } from './accounts/cashu-account';
export type {
  FullUser,
  GuestUser,
  User,
  UserProfile,
} from './user/user';
export type { Contact } from './contacts/contact';
export type {
  TransactionDirection,
  TransactionType,
  TransactionState,
  TransactionPurpose,
} from './transactions/transaction-enums';
export type { Transaction } from './transactions/transaction';
export type { CashuLightningReceiveTransactionDetails } from './transactions/transaction-details/cashu-lightning-receive-transaction-details';
export type {
  IncompleteCashuLightningSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  CashuLightningSendTransactionDetails,
} from './transactions/transaction-details/cashu-lightning-send-transaction-details';
export type { CashuTokenReceiveTransactionDetails } from './transactions/transaction-details/cashu-token-receive-transaction-details';
export type { CashuTokenSendTransactionDetails } from './transactions/transaction-details/cashu-token-send-transaction-details';
export type {
  IncompleteSparkLightningReceiveTransactionDetails,
  CompletedSparkLightningReceiveTransactionDetails,
  SparkLightningReceiveTransactionDetails,
} from './transactions/transaction-details/spark-lightning-receive-transaction-details';
export type {
  IncompleteSparkLightningSendTransactionDetails,
  CompletedSparkLightningSendTransactionDetails,
  SparkLightningSendTransactionDetails,
} from './transactions/transaction-details/spark-lightning-send-transaction-details';
export type { TransactionDetails } from './transactions/transaction-details/transaction-details-types';
export type { CashuTokenMeltData } from './receive/cashu-token-melt-data';
export type { SparkReceiveQuote } from './receive/spark-receive-quote';
export type {
  SparkReceiveLightningQuote,
  GetLightningQuoteParams,
  CreateQuoteBaseParams,
} from './receive/spark-receive-quote-core';
export type { CashuReceiveQuote } from './receive/cashu-receive-quote';
export type { CashuReceiveLightningQuote } from './receive/cashu-receive-quote-core';
export type { CashuReceiveSwap } from './receive/cashu-receive-swap';
export type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from './receive/receive-cashu-token-models';
export type { CrossAccountReceiveQuotesResult } from './receive/receive-cashu-token-quote-service';
export type {
  GiftCardConfig,
  GiftCardInfo,
} from './gift-cards/gift-card-config';
export type { CashuSendQuote } from './send/cashu-send-quote';
export type {
  GetCashuLightningQuoteOptions,
  CashuLightningQuote,
  SendQuoteRequest,
} from './send/cashu-send-quote-service';
export type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from './send/cashu-send-swap';
export type { CashuSwapQuote } from './send/cashu-send-swap-service';
export type { SparkSendQuote } from './send/spark-send-quote';
export type { SparkLightningQuote } from './send/spark-send-quote-service';
export type { SendDestination } from './send/resolve-destination';
export type { ValidateResult } from './send/validation';
export type {
  TransferReceiveSide,
  TransferSendSide,
  TransferQuote,
} from './transfer/transfer-service';
