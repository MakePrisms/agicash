import type { CashuLightningQuote } from '../send/cashu-send-quote-service';
import type { CashuSwapQuote } from '../send/cashu-send-swap-service';
import type { DestinationDetails } from '../send/send-destination';
import type { SparkLightningQuote } from '../send/spark-send-quote-service';

// The public send types are the domain entities for now: only the apps consume
// the SDK and they just read these shapes, so fields like proofs and userId
// ride along until a later slice narrows the surface (#1164).
export type { CashuSendQuote } from '../send/cashu-send-quote';
export type { CashuSendSwap } from '../send/cashu-send-swap';
export type { SparkSendQuote } from '../send/spark-send-quote';

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
