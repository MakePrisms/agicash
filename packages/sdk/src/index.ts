// Configuration
export { configure, getConfig } from './config';
export type { AgicashConfig } from './config';
export { measureOperation, setMeasureOperation } from './performance';
export type { MeasureOperationFn } from './performance';

// Interfaces
export type { KeyProvider } from './interfaces/key-provider';
export type { Cache } from './interfaces/cache';

// Database types
export type {
  AgicashDb,
  AgicashDbUser,
  AgicashDbAccount,
  AgicashDbCashuProof,
  AgicashDbAccountWithProofs,
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
  AgicashDbTransaction,
  AgicashDbContact,
  AgicashDbSparkReceiveQuote,
  AgicashDbSparkSendQuote,
  Database,
} from './db/database';
export { isCashuAccount, isSparkAccount } from './db/database';

// Money
export { Money } from './lib/money';
export type { Currency, CurrencyUnit } from './lib/money';

// Accounts
export type {
  Account,
  AccountType,
  AccountPurpose,
  CashuAccount,
  SparkAccount,
  ExtendedAccount,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
  RedactedAccount,
  RedactedCashuAccount,
} from './features/accounts/account';
export {
  canSendToLightning,
  canReceiveFromLightning,
  getAccountBalance,
} from './features/accounts/account';
export { AccountService } from './features/accounts/account-service';
export { AccountRepository } from './features/accounts/account-repository';
export type { CashuProof } from './features/accounts/cashu-account';
export { CashuProofSchema, toProof } from './features/accounts/cashu-account';

// Contacts
export type { Contact } from './features/contacts/contact';
export { isContact } from './features/contacts/contact';
export { ContactRepository } from './features/contacts/contact-repository';

// User
export type { User, FullUser, GuestUser, UserProfile } from './features/user/user';
export { shouldVerifyEmail, shouldAcceptTerms } from './features/user/user';
export { UserService } from './features/user/user-service';
export { WriteUserRepository, ReadUserRepository, toUser } from './features/user/user-repository';
export type { UpdateUser } from './features/user/user-repository';

// Transactions
export type { Transaction } from './features/transactions/transaction';
export { TransactionSchema, BaseTransactionSchema } from './features/transactions/transaction';
export type {
  TransactionDirection,
  TransactionType,
  TransactionState,
  TransactionPurpose,
} from './features/transactions/transaction-enums';
export {
  TransactionDirectionSchema,
  TransactionTypeSchema,
  TransactionStateSchema,
  TransactionPurposeSchema,
} from './features/transactions/transaction-enums';
export { TransactionRepository } from './features/transactions/transaction-repository';
export type { Cursor } from './features/transactions/transaction-repository';
export type { TransactionDetails } from './features/transactions/transaction-details/transaction-details-types';
export {
  TransactionDetailsDbDataSchema,
  TransactionDetailsSchema,
} from './features/transactions/transaction-details/transaction-details-types';
export { TransactionDetailsParser } from './features/transactions/transaction-details/transaction-details-parser';

// Receive - Cashu
export type { CashuReceiveQuote } from './features/receive/cashu-receive-quote';
export { CashuReceiveQuoteSchema } from './features/receive/cashu-receive-quote';
export type { CashuReceiveLightningQuote } from './features/receive/cashu-receive-quote-core';
export { CashuReceiveQuoteService } from './features/receive/cashu-receive-quote-service';
export { CashuReceiveQuoteRepository } from './features/receive/cashu-receive-quote-repository';
export type { CashuReceiveSwap } from './features/receive/cashu-receive-swap';
export { CashuReceiveSwapSchema } from './features/receive/cashu-receive-swap';
export { CashuReceiveSwapService } from './features/receive/cashu-receive-swap-service';
export { CashuReceiveSwapRepository } from './features/receive/cashu-receive-swap-repository';
export { ClaimCashuTokenService } from './features/receive/claim-cashu-token-service';
export { ReceiveCashuTokenQuoteService } from './features/receive/receive-cashu-token-quote-service';
export type { CrossAccountReceiveQuotesResult } from './features/receive/receive-cashu-token-quote-service';
export { ReceiveCashuTokenService } from './features/receive/receive-cashu-token-service';
export type { CashuTokenMeltData } from './features/receive/cashu-token-melt-data';
export { CashuTokenMeltDataSchema } from './features/receive/cashu-token-melt-data';

// Receive - Spark
export type { SparkReceiveQuote } from './features/receive/spark-receive-quote';
export { SparkReceiveQuoteSchema } from './features/receive/spark-receive-quote';
export { SparkReceiveQuoteService } from './features/receive/spark-receive-quote-service';
export { SparkReceiveQuoteRepository } from './features/receive/spark-receive-quote-repository';

// Send - Cashu
export type { CashuSendQuote, DestinationDetails } from './features/send/cashu-send-quote';
export { CashuSendQuoteSchema, DestinationDetailsSchema } from './features/send/cashu-send-quote';
export { CashuSendQuoteService } from './features/send/cashu-send-quote-service';
export type {
  CashuLightningQuote,
  GetCashuLightningQuoteOptions,
  SendQuoteRequest,
} from './features/send/cashu-send-quote-service';
export { CashuSendQuoteRepository } from './features/send/cashu-send-quote-repository';
export type { CashuSendSwap, PendingCashuSendSwap } from './features/send/cashu-send-swap';
export { CashuSendSwapSchema } from './features/send/cashu-send-swap';
export { CashuSendSwapService } from './features/send/cashu-send-swap-service';
export type { CashuSwapQuote } from './features/send/cashu-send-swap-service';
export { CashuSendSwapRepository } from './features/send/cashu-send-swap-repository';
export { ProofStateSubscriptionManager } from './features/send/proof-state-subscription-manager';

// Send - Spark
export type { SparkSendQuote } from './features/send/spark-send-quote';
export { SparkSendQuoteSchema } from './features/send/spark-send-quote';
export { SparkSendQuoteService } from './features/send/spark-send-quote-service';
export type { SparkLightningQuote } from './features/send/spark-send-quote-service';
export { SparkSendQuoteRepository } from './features/send/spark-send-quote-repository';

// Shared features
export type { CashuCryptography } from './features/shared/cashu';
export {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  tokenToMoney,
  getTokenHash,
  getCashuCryptography,
  getInitializedCashuWallet,
  mintInfoQueryKey,
  allMintKeysetsQueryKey,
  mintKeysQueryKey,
} from './features/shared/cashu';
export { derivePublicKey } from './features/shared/cryptography';
export { getDefaultUnit } from './features/shared/currencies';
export type { Encryption } from './features/shared/encryption';
export {
  encryptToPublicKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  decryptBatchWithPrivateKey,
  getEncryption,
  serializeData,
  deserializeData,
} from './features/shared/encryption';
export {
  getErrorMessage,
  UniqueConstraintError,
  NotFoundError,
  DomainError,
  ConcurrencyError,
} from './features/shared/error';
export { getInitializedSparkWallet, sparkWalletCacheKey } from './features/shared/spark';

// Wallet
export { TaskProcessingLockRepository } from './features/wallet/task-processing-lock-repository';

// Lib - Bolt11
export type { DecodedBolt11 } from './lib/bolt11';
export { decodeBolt11, parseBolt11Invoice } from './lib/bolt11';

// Lib - Exchange rate
export { ExchangeRateService, getExchangeRateService } from './lib/exchange-rate';
export type { ExchangeRateProvider, Ticker, Rates } from './lib/exchange-rate';

// Lib - LNURL
export {
  isLNURLError,
  getLNURLPayParams,
  getInvoiceFromLud16,
  isValidLightningAddress,
  buildLightningAddressFormatValidator,
  buildLightningAddressValidator,
} from './lib/lnurl';
export type { LNURLPayResult, LNURLError } from './lib/lnurl';

// Lib - Supabase realtime
export { SupabaseRealtimeManager } from './lib/supabase/supabase-realtime-manager';
export type { ChannelStatus } from './lib/supabase/supabase-realtime-manager';
export { RealtimeChannelBuilder } from './lib/supabase/supabase-realtime-channel-builder';
export { SupabaseRealtimeChannel } from './lib/supabase/supabase-realtime-channel';

// Lib - Utilities
export { sum, isSubset, isObject } from './lib/utils';
export { safeJsonParse } from './lib/json';
export { computeSHA256 } from './lib/sha256';
export { getLocaleDecimalSeparator } from './lib/locale';
export { default as delay } from './lib/delay';
export type { DelayOptions } from './lib/delay';
export { setLongTimeout, clearLongTimeout } from './lib/timeout';
export type { LongTimeout } from './lib/timeout';
export { nullToUndefined } from './lib/zod';
export type { AllUnionFieldsRequired } from './lib/type-utils';
