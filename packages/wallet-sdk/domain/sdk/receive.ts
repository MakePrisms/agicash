import type { Money } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import type { CashuAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';
import type { TransactionPurpose } from '../transactions/transaction-enums';

// The public receive types are the domain entities for now: only the apps
// consume the SDK and they just read these shapes, so the extra domain fields
// (e.g. proofs) ride along until a later slice narrows the surface (#1164).
export type { CashuReceiveSwap, CashuReceiveQuote, SparkReceiveQuote };

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
    /**
     * Claims a token into a same-mint account by creating a receive swap.
     * @throws {DomainError} When the token does not match the account's mint
     * or currency, or is too small to cover the mint fee.
     * @throws {UniqueConstraintError} When a swap for this token already exists.
     */
    createSwap(
      params: CreateCashuReceiveSwapParams,
    ): Promise<CreatedCashuReceiveSwap>;
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
    getQuote(
      params: GetReceiveCashuTokenQuoteParams,
    ): Promise<ReceiveCashuTokenQuote>;
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
  /** The token to receive. */
  token: Token;
};

export type CreatedCashuReceiveSwap = {
  /** The created receive swap. Completion is background-driven, never called by the host. */
  swap: CashuReceiveSwap;
  /** The receiving account with the keyset counter advanced for the swap's reserved outputs. */
  account: CashuAccount;
};

export type GetSparkReceiveLightningQuoteParams = unknown; // step 11 (spark receive quote)
export type CreateSparkReceiveQuoteParams = unknown; // step 11 (spark receive quote)
export type GetReceiveCashuTokenQuoteParams = unknown; // step 12 (receive cashu token)
export type ReceiveCashuTokenQuote = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenParams = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenResult = unknown; // step 12 (receive cashu token)
