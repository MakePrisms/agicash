import type { CashuReceiveQuote as DomainCashuReceiveQuote } from '../domain/receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../domain/receive/cashu-receive-quote-core';
import type { CashuReceiveSwap as DomainCashuReceiveSwap } from '../domain/receive/cashu-receive-swap';
import type { SparkReceiveQuote as DomainSparkReceiveQuote } from '../domain/receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../domain/receive/spark-receive-quote-core';

export type CashuReceiveQuote = Omit<DomainCashuReceiveQuote, 'userId'>;
export type SparkReceiveQuote = Omit<DomainSparkReceiveQuote, 'userId'>;
export type CashuReceiveSwap = Omit<DomainCashuReceiveSwap, 'userId'>;

/**
 * `get*` methods are stateless previews; `create*` methods persist and enter
 * the entity into the background lifecycle. Completion is observed via
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
