// Migration-only TYPE re-exports — the wallet DB layer plus repository/service
// contracts that have no value export below. These become SDK-internal once
// /temporary is removed; only domain types stay in '@agicash/wallet-sdk'.
export type {
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
  AgicashDb,
} from './db/database';
export type { AccountDetailsDbData } from './db/json-models/account-details-db-data';
export type { CashuAccountDetailsDbData } from './db/json-models/cashu-account-details-db-data';
export type { CashuLightningReceiveDbData } from './db/json-models/cashu-lightning-receive-db-data';
export type { CashuLightningSendDbData } from './db/json-models/cashu-lightning-send-db-data';
export type { CashuSwapReceiveDbData } from './db/json-models/cashu-swap-receive-db-data';
export type { CashuSwapSendDbData } from './db/json-models/cashu-swap-send-db-data';
export type { CashuTokenMeltDbData } from './db/json-models/cashu-token-melt-db-data';
export type { SparkAccountDetailsDbData } from './db/json-models/spark-account-details-db-data';
export type { SparkLightningReceiveDbData } from './db/json-models/spark-lightning-receive-db-data';
export type { SparkLightningSendDbData } from './db/json-models/spark-lightning-send-db-data';
export type { CashuCryptography } from './lib/cashu';
export type { Encryption } from './lib/encryption';
export type { UpdateUser } from './domain/user/user-repository';
export type { Cursor } from './domain/transactions/transaction-repository';
export type {
  TransactionDetailsParserInput,
  TransactionDetailsParserShape,
} from './domain/transactions/transaction-details/transaction-details-types';
export type { RepositoryCreateQuoteParams } from './domain/receive/spark-receive-quote-core';
export {
  decryptBatchWithPrivateKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  encryptToPublicKey,
  getEncryption,
} from './lib/encryption';
export * from './lib/spark';
export {
  ConcurrencyError,
  DomainError,
  NotFoundError,
  UniqueConstraintError,
} from './lib/error';
export { DestinationDetailsSchema } from './domain/send/send-destination';
export {
  deriveCashuXpub,
  derivePublicKey,
  getSeedPhraseDerivationPath,
} from './lib/cryptography';
export {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  cashuMintValidator,
  decodeCashuToken,
  getAllMintKeysets,
  getCashuPrivateKey,
  getCashuSeed,
  getInitializedCashuWallet,
  getMintAuthProvider,
  getMintInfo,
  getTokenHash,
  tokenToMoney,
} from './lib/cashu';
export {
  isCashuAccount,
  isSparkAccount,
} from './db/database';
export { clearAgicashMintAuthToken } from './lib/agicash-mint-auth-provider';
export { AccountDetailsDbDataSchema } from './db/json-models/account-details-db-data';
export { CashuAccountDetailsDbDataSchema } from './db/json-models/cashu-account-details-db-data';
export { CashuLightningReceiveDbDataSchema } from './db/json-models/cashu-lightning-receive-db-data';
export { CashuLightningSendDbDataSchema } from './db/json-models/cashu-lightning-send-db-data';
export { CashuSwapReceiveDbDataSchema } from './db/json-models/cashu-swap-receive-db-data';
export { CashuSwapSendDbDataSchema } from './db/json-models/cashu-swap-send-db-data';
export { CashuTokenMeltDbDataSchema } from './db/json-models/cashu-token-melt-db-data';
export { SparkAccountDetailsDbDataSchema } from './db/json-models/spark-account-details-db-data';
export { SparkLightningReceiveDbDataSchema } from './db/json-models/spark-lightning-receive-db-data';
export { SparkLightningSendDbDataSchema } from './db/json-models/spark-lightning-send-db-data';
export {
  FEATURE_FLAG_DEFAULTS,
  configureFeatureFlags,
  getFeatureFlag,
  refreshFeatureFlags,
  resetFeatureFlags,
  subscribeToFeatureFlags,
} from './domain/feature-flags/feature-flag-service';
export {
  AccountPurposeSchema,
  AccountTypeSchema,
  accountRequiresGiftCardTermsAcceptance,
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
  getAccountHomePath,
} from './domain/accounts/account';
export { CashuProofSchema, toProof } from './domain/accounts/cashu-account';
export { AccountRepository } from './domain/accounts/account-repository';
export { AccountService } from './domain/accounts/account-service';
// Accounts-slice bridge (step 6): the internal-repo accessor hands unmigrated
// receive/send flows and realtime row mapping the current instance's domain
// accounts repository, and the session-keys accessor feeds the host's key
// queries the unmigrated flows still read. Removed at step 18 when those flows
// read from the SDK.
export {
  getInternalAccountRepository,
  getInternalSessionKeys,
} from './domain/sdk/sdk';
export {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
  UpdateUserRepository,
  UpsertUserRepository,
} from './domain/user/user-repository';
export { UserService } from './domain/user/user-service';
export { isContact } from './domain/contacts/contact';
export { ContactRepository } from './domain/contacts/contact-repository';
export {
  TransactionDirectionSchema,
  TransactionTypeSchema,
  TransactionStateSchema,
  TransactionPurposeSchema,
} from './domain/transactions/transaction-enums';
export {
  BaseTransactionSchema,
  TransactionSchema,
} from './domain/transactions/transaction';
export {
  CashuLightningReceiveTransactionDetailsSchema,
  CashuLightningReceiveTransactionDetailsParser,
} from './domain/transactions/transaction-details/cashu-lightning-receive-transaction-details';
export {
  IncompleteCashuLightningSendTransactionDetailsSchema,
  CompletedCashuLightningSendTransactionDetailsSchema,
  CashuLightningSendTransactionDetailsSchema,
  CashuLightningSendTransactionDetailsParser,
} from './domain/transactions/transaction-details/cashu-lightning-send-transaction-details';
export {
  CashuTokenReceiveTransactionDetailsSchema,
  CashuTokenReceiveTransactionDetailsParser,
} from './domain/transactions/transaction-details/cashu-token-receive-transaction-details';
export {
  CashuTokenSendTransactionDetailsSchema,
  CashuTokenSendTransactionDetailsParser,
} from './domain/transactions/transaction-details/cashu-token-send-transaction-details';
export {
  IncompleteSparkLightningReceiveTransactionDetailsSchema,
  CompletedSparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsParser,
} from './domain/transactions/transaction-details/spark-lightning-receive-transaction-details';
export {
  IncompleteSparkLightningSendTransactionDetailsSchema,
  CompletedSparkLightningSendTransactionDetailsSchema,
  SparkLightningSendTransactionDetailsSchema,
  SparkLightningSendTransactionDetailsParser,
} from './domain/transactions/transaction-details/spark-lightning-send-transaction-details';
export {
  TransactionDetailsDbDataSchema,
  TransactionDetailsSchema,
} from './domain/transactions/transaction-details/transaction-details-types';
export { TransactionDetailsParser } from './domain/transactions/transaction-details/transaction-details-parser';
export { TransactionRepository } from './domain/transactions/transaction-repository';
export { CashuTokenMeltDataSchema } from './domain/receive/cashu-token-melt-data';
export { SparkReceiveQuoteSchema } from './domain/receive/spark-receive-quote';
export {
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './domain/receive/spark-receive-quote-core';
export { SparkReceiveQuoteRepository } from './domain/receive/spark-receive-quote-repository';
export { SparkReceiveQuoteService } from './domain/receive/spark-receive-quote-service';
export { CashuReceiveQuoteSchema } from './domain/receive/cashu-receive-quote';
export {
  computeTotalFee,
  deriveNut20LockingPublicKey,
} from './domain/receive/cashu-receive-quote-core';
export { CashuReceiveQuoteRepository } from './domain/receive/cashu-receive-quote-repository';
export { CashuReceiveQuoteService } from './domain/receive/cashu-receive-quote-service';
export { CashuReceiveSwapSchema } from './domain/receive/cashu-receive-swap';
export { CashuReceiveSwapRepository } from './domain/receive/cashu-receive-swap-repository';
export { CashuReceiveSwapService } from './domain/receive/cashu-receive-swap-service';
export { isClaimingToSameCashuAccount } from './domain/receive/receive-cashu-token-models';
export { ReceiveCashuTokenQuoteService } from './domain/receive/receive-cashu-token-quote-service';
export { ClaimCashuTokenService } from './domain/receive/claim-cashu-token-service';
export { ReceiveCashuTokenService } from './domain/receive/receive-cashu-token-service';
export { CashuSendQuoteSchema } from './domain/send/cashu-send-quote';
export { CashuSendQuoteRepository } from './domain/send/cashu-send-quote-repository';
export { CashuSendQuoteService } from './domain/send/cashu-send-quote-service';
export { CashuSendSwapSchema } from './domain/send/cashu-send-swap';
export { CashuSendSwapRepository } from './domain/send/cashu-send-swap-repository';
export { CashuSendSwapService } from './domain/send/cashu-send-swap-service';
export { SparkSendQuoteSchema } from './domain/send/spark-send-quote';
export { SparkSendQuoteRepository } from './domain/send/spark-send-quote-repository';
export { SparkSendQuoteService } from './domain/send/spark-send-quote-service';
export { toDecryptedCashuProofs } from './domain/send/utils';
export { ProofStateSubscriptionManager } from './domain/send/proof-state-subscription-manager';
export { resolveSendDestination } from './domain/send/resolve-destination';
export {
  validateBolt11,
  validateLightningAddressFormat,
} from './domain/send/validation';
export { findMatchingOfferOrGiftCardAccount } from './domain/send/find-matching-offer-or-gift-card-account';
export { TransferService } from './domain/transfer/transfer-service';
export { TaskProcessingLockRepository } from './domain/wallet/task-processing-lock-repository';
