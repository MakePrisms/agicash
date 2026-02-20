// ---------------------------------------------------------------------------
// @agicash/core - public barrel exports
//
// For items not exported here, use deep imports:
//   import { ... } from '@agicash/core/lib/cashu/proof'
//   import { ... } from '@agicash/core/db/database'
// ---------------------------------------------------------------------------

// -- Configuration ----------------------------------------------------------
export { configure, getConfig } from './config';
export type { AgicashConfig, MintBlocklistEntry } from './config';
export {
  measureOperation,
  setMeasureOperation,
} from './performance';
export type { MeasureOperationFn } from './performance';

// -- Interfaces (platform adapters) ----------------------------------------
export type { KeyProvider } from './interfaces/key-provider';
export type { Cache } from './interfaces/cache';

// -- Errors -----------------------------------------------------------------
export {
  DomainError,
  ConcurrencyError,
  NotFoundError,
  UniqueConstraintError,
  getErrorMessage,
} from './features/shared/error';

// -- Money ------------------------------------------------------------------
export { Money } from './lib/money';
export type { Currency, CurrencyUnit } from './lib/money';

// -- Accounts ---------------------------------------------------------------
export type {
  Account,
  AccountType,
  AccountPurpose,
  ExtendedAccount,
  CashuAccount,
  SparkAccount,
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
export { accountOfflineToast } from './features/accounts/utils';
export type { CashuProof } from './features/accounts/cashu-account';
export { toProof } from './features/accounts/cashu-account';
export { getSeedPhraseDerivationPath } from './features/accounts/account-cryptography';

// -- User -------------------------------------------------------------------
export type {
  User,
  FullUser,
  GuestUser,
  UserProfile,
} from './features/user/user';
export {
  shouldVerifyEmail,
  shouldAcceptTerms,
} from './features/user/user';
export { UserService } from './features/user/user-service';

// -- Contacts ---------------------------------------------------------------
export type { Contact } from './features/contacts/contact';
export { isContact } from './features/contacts/contact';

// -- Transactions -----------------------------------------------------------
export type { Transaction } from './features/transactions/transaction';
export {
  TransactionSchema,
  BaseTransactionSchema,
} from './features/transactions/transaction';
export type {
  TransactionDirection,
  TransactionType,
  TransactionState,
} from './features/transactions/transaction-enums';
export {
  TransactionDirectionSchema,
  TransactionTypeSchema,
  TransactionStateSchema,
} from './features/transactions/transaction-enums';

// -- Theme ------------------------------------------------------------------
export type {
  Theme,
  ColorMode,
  ThemeCookieValues,
  ThemeContextType,
} from './features/theme/theme.types';
export {
  themes,
  colorModes,
  defaultTheme,
  defaultColorMode,
  defaultSystemColorMode,
  THEME_COOKIE_NAME,
  COLOR_MODE_COOKIE_NAME,
  SYSTEM_COLOR_MODE_COOKIE_NAME,
} from './features/theme/theme.constants';
export { bgColors, getBgColorForTheme } from './features/theme/colors';

// -- Currencies -------------------------------------------------------------
export { getDefaultUnit } from './features/shared/currencies';

// -- Encryption -------------------------------------------------------------
export type { Encryption } from './features/shared/encryption';
export {
  getEncryption,
  encryptToPublicKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  decryptBatchWithPrivateKey,
  serializeData,
  deserializeData,
} from './features/shared/encryption';

// -- Cryptography -----------------------------------------------------------
export { derivePublicKey } from './features/shared/cryptography';

// -- Cashu shared -----------------------------------------------------------
export type { CashuCryptography } from './features/shared/cashu';
export {
  getCashuCryptography,
  getInitializedCashuWallet,
  tokenToMoney,
  getTokenHash,
  cashuMintValidator,
  BASE_CASHU_LOCKING_DERIVATION_PATH,
} from './features/shared/cashu';

// -- Spark shared -----------------------------------------------------------
export {
  getInitializedSparkWallet,
  getLeafDenominations,
} from './features/shared/spark';

// -- Database ---------------------------------------------------------------
export type {
  AgicashDb,
  Database,
  AgicashDbUser,
  AgicashDbAccount,
  AgicashDbAccountWithProofs,
  AgicashDbCashuProof,
  AgicashDbTransaction,
  AgicashDbContact,
} from './db/database';
export { isCashuAccount, isSparkAccount } from './db/database';
