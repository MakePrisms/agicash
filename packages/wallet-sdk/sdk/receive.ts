import type {
  CashuReceiveQuoteStateVariant,
  CashuReceiveQuoteTypeVariant,
  CashuReceiveQuote as DomainCashuReceiveQuote,
} from '../domain/receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../domain/receive/cashu-receive-quote-core';
import type {
  CashuReceiveSwapStateVariant,
  CashuReceiveSwap as DomainCashuReceiveSwap,
} from '../domain/receive/cashu-receive-swap';
import type { CashuTokenMeltData } from '../domain/receive/cashu-token-melt-data';
import type {
  SparkReceiveQuote as DomainSparkReceiveQuote,
  SparkReceiveQuoteStateVariant,
  SparkReceiveQuoteTypeVariant,
} from '../domain/receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../domain/receive/spark-receive-quote-core';

// The domain entities are intersections over variant unions (`Base & (A | B)`),
// and a bare `Omit` over such a type collapses each union to its shared keys —
// variant-only fields silently vanish and discriminant narrowing breaks. The
// projections below therefore omit base keys only and re-apply the variant
// unions. Spendable Cashu proof material (top-level `tokenProofs` and the
// melt data's `tokenProofs`) is stripped from the public shapes; the
// implementing slices (steps 9/11/12) must strip it at runtime at this same
// boundary.

/** Distributes over a type-variant union, stripping proofs from the melt data. */
type WithPublicTokenReceiveData<T> = T extends {
  tokenReceiveData: CashuTokenMeltData;
}
  ? Omit<T, 'tokenReceiveData'> & {
      tokenReceiveData: Omit<CashuTokenMeltData, 'tokenProofs'>;
    }
  : T;

export type CashuReceiveQuote = Omit<
  DomainCashuReceiveQuote,
  'userId' | 'type' | 'state'
> &
  WithPublicTokenReceiveData<CashuReceiveQuoteTypeVariant> &
  CashuReceiveQuoteStateVariant;

export type SparkReceiveQuote = Omit<
  DomainSparkReceiveQuote,
  'userId' | 'type' | 'state'
> &
  WithPublicTokenReceiveData<SparkReceiveQuoteTypeVariant> &
  SparkReceiveQuoteStateVariant;

export type CashuReceiveSwap = Omit<
  DomainCashuReceiveSwap,
  'userId' | 'tokenProofs' | 'state'
> &
  CashuReceiveSwapStateVariant;

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
