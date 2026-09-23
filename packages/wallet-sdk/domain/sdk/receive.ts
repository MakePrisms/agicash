import type { Money } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import type { CrossAccountReceiveQuotesResult } from '../receive/receive-cashu-token-quote-service';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { User } from '../user/user';

// The public receive types are the domain entities for now: only the apps
// consume the SDK and they just read these shapes, so the extra domain fields
// (e.g. proofs) ride along until a later slice narrows the surface (#1164).
export type { CashuReceiveSwap };
export type { CashuReceiveQuote, SparkReceiveQuote };

/**
 * `get*` methods are stateless previews; `create*` methods persist and enter
 * the entity into the task-processor lifecycle. Completion is observed via
 * `events`, never called by the host.
 */
export type ReceiveApi = {
  cashu: {
    getLightningQuote(
      params: GetCashuReceiveLightningQuoteParams,
    ): Promise<CashuReceiveLightningQuote>;
    createQuote(
      params: CreateCashuReceiveQuoteParams,
    ): Promise<CashuReceiveQuote>;
    getQuote(id: string): Promise<CashuReceiveQuote | null>;
    createSwap(
      params: CreateCashuReceiveSwapParams,
    ): Promise<CreateCashuReceiveSwapResult>;
  };
  spark: {
    getLightningQuote(
      params: GetSparkReceiveLightningQuoteParams,
    ): Promise<SparkReceiveLightningQuote>;
    createQuote(
      params: CreateSparkReceiveQuoteParams,
    ): Promise<SparkReceiveQuote>;
    getQuote(id: string): Promise<SparkReceiveQuote | null>;
  };
  cashuToken: {
    createQuotes(
      params: CreateReceiveCashuTokenQuotesParams,
    ): Promise<ReceiveCashuTokenQuotes>;
    claim(params: ClaimCashuTokenParams): Promise<ClaimCashuTokenResult>;
  };
};

export type GetCashuReceiveLightningQuoteParams = {
  /** The cashu account to receive into. */
  account: CashuAccount;
  /** The amount to receive. */
  amount: Money;
  /** The description of the receive request. */
  description?: string;
};

export type CreateCashuReceiveQuoteParams = {
  /** The cashu account to receive into. */
  account: CashuAccount;
  /** The lightning quote to create the receive quote from (see `getLightningQuote`). */
  lightningQuote: CashuReceiveLightningQuote;
  /** The purpose of the transaction. When not provided, PAYMENT is used. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

export type CreateCashuReceiveSwapParams = {
  /** The cashu account to receive the token into. Must match the token's mint and currency. */
  account: CashuAccount;
  /** The cashu token to receive. */
  token: Token;
};

export type CreateCashuReceiveSwapResult = {
  /** The created receive swap; completion happens in the background. */
  swap: CashuReceiveSwap;
  /** The receiving account with the updated keyset counter. */
  account: CashuAccount;
};

export type GetSparkReceiveLightningQuoteParams = {
  /** The spark account to receive into. */
  account: SparkAccount;
  /** The amount to receive. */
  amount: Money;
  /** The description of the receive request. */
  description?: string;
};

export type CreateSparkReceiveQuoteParams = {
  /** The spark account to receive into. */
  account: SparkAccount;
  /** The lightning quote to create the receive quote from (see `getLightningQuote`). */
  lightningQuote: SparkReceiveLightningQuote;
  /** The purpose of the transaction. When not provided, PAYMENT is used. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

export type CreateReceiveCashuTokenQuotesParams = {
  /** The cashu token to receive. */
  token: Token;
  /**
   * The account to claim the token from. May be a placeholder account if the
   * token is from a mint the user does not yet have.
   */
  sourceAccount: CashuAccount;
  /** The account to claim the token to. */
  destinationAccount: Account;
  /** The exchange rate to use for cross-currency quotes, as a decimal string. */
  exchangeRate: string;
};

export type ReceiveCashuTokenQuotes = CrossAccountReceiveQuotesResult;

export type ClaimCashuTokenParams = {
  /** The cashu token to claim. */
  token: Token;
  /** Whether to claim the token to a cashu or spark account. */
  claimTo: 'cashu' | 'spark';
  /** The user's accounts, already loaded by the caller. */
  accounts: Account[];
  /**
   * The current user (for default-account flags). Must be the session user;
   * `requireUserId()` still gates the write.
   */
  user: User;
};

export type ClaimCashuTokenResult =
  | {
      success: true;
      /** The account the token was claimed into. */
      receiveAccount: Account;
      /** Accounts created or updated while claiming, for the caller to write into its cache. */
      changedAccounts: Account[];
    }
  | { success: false; message: string; error?: unknown };
