import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';

// The public receive types are the domain entities for now: only the apps
// consume the SDK and they just read these shapes, so the extra domain fields
// (e.g. proofs) ride along until a later slice narrows the surface (#1164).
export type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
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

export type GetCashuReceiveLightningQuoteParams = unknown; // step 9 (cashu receive quote)
export type CreateCashuReceiveQuoteParams = unknown; // step 9 (cashu receive quote)
export type GetSparkReceiveLightningQuoteParams = unknown; // step 11 (spark receive quote)
export type CreateSparkReceiveQuoteParams = unknown; // step 11 (spark receive quote)
export type GetReceiveCashuTokenQuoteParams = unknown; // step 12 (receive cashu token)
export type ReceiveCashuTokenQuote = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenParams = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenResult = unknown; // step 12 (receive cashu token)
