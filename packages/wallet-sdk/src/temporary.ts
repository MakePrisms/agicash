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
} from './agicash-db/database';
export type { AccountDetailsDbData } from './agicash-db/json-models/account-details-db-data';
export type { CashuAccountDetailsDbData } from './agicash-db/json-models/cashu-account-details-db-data';
export type { CashuLightningReceiveDbData } from './agicash-db/json-models/cashu-lightning-receive-db-data';
export type { CashuLightningSendDbData } from './agicash-db/json-models/cashu-lightning-send-db-data';
export type { CashuSwapReceiveDbData } from './agicash-db/json-models/cashu-swap-receive-db-data';
export type { CashuSwapSendDbData } from './agicash-db/json-models/cashu-swap-send-db-data';
export type { CashuTokenMeltDbData } from './agicash-db/json-models/cashu-token-melt-db-data';
export type { SparkAccountDetailsDbData } from './agicash-db/json-models/spark-account-details-db-data';
export type { SparkLightningReceiveDbData } from './agicash-db/json-models/spark-lightning-receive-db-data';
export type { SparkLightningSendDbData } from './agicash-db/json-models/spark-lightning-send-db-data';
export type { CashuCryptography } from './shared/cashu';
export type { Encryption } from './shared/encryption';
export type { UpdateUser } from './user/user-repository';
export type { Cursor } from './transactions/transaction-repository';
export type {
  TransactionDetailsParserInput,
  TransactionDetailsParserShape,
} from './transactions/transaction-details/transaction-details-types';
export type { RepositoryCreateQuoteParams } from './receive/spark-receive-quote-core';
export {
  decryptBatchWithPrivateKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  encryptToPublicKey,
  getEncryption,
} from './shared/encryption';
export * from './lib/spark';
export * from './lib/exchange-rate';
export {
  ConcurrencyError,
  DomainError,
  NotFoundError,
  UniqueConstraintError,
  getErrorMessage,
} from './shared/error';
export { getDefaultUnit } from './shared/currencies';
export { DestinationDetailsSchema } from './shared/send-destination';
export {
  derivePublicKey,
  getSeedPhraseDerivationPath,
} from './shared/cryptography';
export {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  allMintKeysetsQueryKey,
  allMintKeysetsQueryOptions,
  cashuMintValidator,
  decodeCashuToken,
  getCashuCryptography,
  getInitializedCashuWallet,
  getMintAuthProvider,
  getTokenHash,
  mintInfoQueryKey,
  mintInfoQueryOptions,
  seedQueryOptions,
  tokenToMoney,
  xpubQueryOptions,
} from './shared/cashu';
export {
  isCashuAccount,
  isSparkAccount,
} from './agicash-db/database';
export {
  clearSparkWallets,
  getInitializedSparkWallet,
  getSparkWallet,
  sparkDebugLog,
  sparkIdentityPublicKeyQueryOptions,
  sparkMnemonicQueryOptions,
} from './shared/spark';
export { AccountDetailsDbDataSchema } from './agicash-db/json-models/account-details-db-data';
export { CashuAccountDetailsDbDataSchema } from './agicash-db/json-models/cashu-account-details-db-data';
export { CashuLightningReceiveDbDataSchema } from './agicash-db/json-models/cashu-lightning-receive-db-data';
export { CashuLightningSendDbDataSchema } from './agicash-db/json-models/cashu-lightning-send-db-data';
export { CashuSwapReceiveDbDataSchema } from './agicash-db/json-models/cashu-swap-receive-db-data';
export { CashuSwapSendDbDataSchema } from './agicash-db/json-models/cashu-swap-send-db-data';
export { CashuTokenMeltDbDataSchema } from './agicash-db/json-models/cashu-token-melt-db-data';
export { SparkAccountDetailsDbDataSchema } from './agicash-db/json-models/spark-account-details-db-data';
export { SparkLightningReceiveDbDataSchema } from './agicash-db/json-models/spark-lightning-receive-db-data';
export { SparkLightningSendDbDataSchema } from './agicash-db/json-models/spark-lightning-send-db-data';
export {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlagService,
} from './shared/feature-flag-service';
export {
  AccountPurposeSchema,
  AccountTypeSchema,
  accountRequiresGiftCardTermsAcceptance,
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
  getAccountHomePath,
} from './accounts/account';
export { CashuProofSchema, toProof } from './accounts/cashu-account';
export { AccountRepository } from './accounts/account-repository';
export { AccountService } from './accounts/account-service';
export {
  shouldAcceptGiftCardMintTerms,
  shouldAcceptTerms,
  shouldVerifyEmail,
} from './user/user';
export {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
  WriteUserRepository,
} from './user/user-repository';
export { UserService } from './user/user-service';
export { isContact } from './contacts/contact';
export { ContactRepository } from './contacts/contact-repository';
export {
  TransactionDirectionSchema,
  TransactionTypeSchema,
  TransactionStateSchema,
  TransactionPurposeSchema,
} from './transactions/transaction-enums';
export {
  BaseTransactionSchema,
  TransactionSchema,
} from './transactions/transaction';
export {
  CashuLightningReceiveTransactionDetailsSchema,
  CashuLightningReceiveTransactionDetailsParser,
} from './transactions/transaction-details/cashu-lightning-receive-transaction-details';
export {
  IncompleteCashuLightningSendTransactionDetailsSchema,
  CompletedCashuLightningSendTransactionDetailsSchema,
  CashuLightningSendTransactionDetailsSchema,
  CashuLightningSendTransactionDetailsParser,
} from './transactions/transaction-details/cashu-lightning-send-transaction-details';
export {
  CashuTokenReceiveTransactionDetailsSchema,
  CashuTokenReceiveTransactionDetailsParser,
} from './transactions/transaction-details/cashu-token-receive-transaction-details';
export {
  CashuTokenSendTransactionDetailsSchema,
  CashuTokenSendTransactionDetailsParser,
} from './transactions/transaction-details/cashu-token-send-transaction-details';
export {
  IncompleteSparkLightningReceiveTransactionDetailsSchema,
  CompletedSparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsParser,
} from './transactions/transaction-details/spark-lightning-receive-transaction-details';
export {
  IncompleteSparkLightningSendTransactionDetailsSchema,
  CompletedSparkLightningSendTransactionDetailsSchema,
  SparkLightningSendTransactionDetailsSchema,
  SparkLightningSendTransactionDetailsParser,
} from './transactions/transaction-details/spark-lightning-send-transaction-details';
export {
  TransactionDetailsDbDataSchema,
  TransactionDetailsSchema,
} from './transactions/transaction-details/transaction-details-types';
export { TransactionDetailsParser } from './transactions/transaction-details/transaction-details-parser';
export { TransactionRepository } from './transactions/transaction-repository';
export { CashuTokenMeltDataSchema } from './receive/cashu-token-melt-data';
export { SparkReceiveQuoteSchema } from './receive/spark-receive-quote';
export {
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './receive/spark-receive-quote-core';
export { SparkReceiveQuoteRepository } from './receive/spark-receive-quote-repository';
export { SparkReceiveQuoteService } from './receive/spark-receive-quote-service';
export { CashuReceiveQuoteSchema } from './receive/cashu-receive-quote';
export {
  computeTotalFee,
  deriveNut20LockingPublicKey,
} from './receive/cashu-receive-quote-core';
export { CashuReceiveQuoteRepository } from './receive/cashu-receive-quote-repository';
export { CashuReceiveQuoteService } from './receive/cashu-receive-quote-service';
export { CashuReceiveSwapSchema } from './receive/cashu-receive-swap';
export { CashuReceiveSwapRepository } from './receive/cashu-receive-swap-repository';
export { CashuReceiveSwapService } from './receive/cashu-receive-swap-service';
export { isClaimingToSameCashuAccount } from './receive/receive-cashu-token-models';
export { ReceiveCashuTokenQuoteService } from './receive/receive-cashu-token-quote-service';
export { ReceiveCashuTokenService } from './receive/receive-cashu-token-service';
export {
  GiftCardConfigSchema,
  JsonGiftCardConfigSchema,
} from './gift-cards/gift-card-config';
export { CashuSendQuoteSchema } from './send/cashu-send-quote';
export { CashuSendQuoteRepository } from './send/cashu-send-quote-repository';
export { CashuSendQuoteService } from './send/cashu-send-quote-service';
export { CashuSendSwapSchema } from './send/cashu-send-swap';
export { CashuSendSwapRepository } from './send/cashu-send-swap-repository';
export { CashuSendSwapService } from './send/cashu-send-swap-service';
export { SparkSendQuoteSchema } from './send/spark-send-quote';
export { SparkSendQuoteRepository } from './send/spark-send-quote-repository';
export { SparkSendQuoteService } from './send/spark-send-quote-service';
export { toDecryptedCashuProofs } from './send/utils';
export { ProofStateSubscriptionManager } from './send/proof-state-subscription-manager';
export { resolveSendDestination } from './send/resolve-destination';
export {
  validateBolt11,
  validateLightningAddressFormat,
} from './send/validation';
export { findMatchingOfferOrGiftCardAccount } from './send/find-matching-offer-or-gift-card-account';
export { TransferService } from './transfer/transfer-service';
export { TaskProcessingLockRepository } from './wallet/task-processing-lock-repository';
