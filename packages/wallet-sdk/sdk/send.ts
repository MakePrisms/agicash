import type { CashuSendQuote as DomainCashuSendQuote } from '../domain/send/cashu-send-quote';
import type { CashuLightningQuote } from '../domain/send/cashu-send-quote-service';
import type { CashuSendSwap as DomainCashuSendSwap } from '../domain/send/cashu-send-swap';
import type { CashuSwapQuote } from '../domain/send/cashu-send-swap-service';
import type { SparkSendQuote as DomainSparkSendQuote } from '../domain/send/spark-send-quote';
import type { SparkLightningQuote } from '../domain/send/spark-send-quote-service';
import type { DestinationDetails } from '../lib/send-destination';

export type CashuSendQuote = Omit<DomainCashuSendQuote, 'userId' | 'proofs'>;
export type CashuSendSwap = Omit<
  DomainCashuSendSwap,
  'inputProofs' | 'proofsToSend' | 'userId'
>;
export type SparkSendQuote = Omit<DomainSparkSendQuote, 'userId'>;

export type SendApi = {
  resolveDestination(input: string): Promise<DestinationDetails>;
  cashu: {
    getLightningQuote(
      params: GetCashuSendLightningQuoteParams,
    ): Promise<CashuLightningQuote>;
    createQuote(
      params: CreateCashuSendQuoteParams,
    ): Promise<{ transactionId: string }>;
    /** Send-to-token. */
    getSwapQuote(params: GetCashuSwapQuoteParams): Promise<CashuSwapQuote>;
    createSwap(params: CreateCashuSwapParams): Promise<CreateCashuSwapResult>;
  };
  spark: {
    getLightningQuote(
      params: GetSparkSendLightningQuoteParams,
    ): Promise<SparkLightningQuote>;
    createQuote(
      params: CreateSparkSendQuoteParams,
    ): Promise<{ transactionId: string }>;
  };
};

export type GetCashuSendLightningQuoteParams = unknown; // step 13 (cashu send quote)
export type CreateCashuSendQuoteParams = unknown; // step 13 (cashu send quote)
export type GetCashuSwapQuoteParams = unknown; // step 14 (cashu send swap)
export type CreateCashuSwapParams = unknown; // step 14 (cashu send swap)
export type CreateCashuSwapResult = unknown; // step 14 (cashu send swap)
export type GetSparkSendLightningQuoteParams = unknown; // step 15 (spark send quote)
export type CreateSparkSendQuoteParams = unknown; // step 15 (spark send quote)
