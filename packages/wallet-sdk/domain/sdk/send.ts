import type { Money } from '@agicash/money';
import type { CashuAccount } from '../accounts/account';
import type { CashuLightningQuote } from '../send/cashu-send-quote-service';
import type { CashuSendSwap } from '../send/cashu-send-swap';
import type { CashuSwapQuote } from '../send/cashu-send-swap-service';
import type { DestinationDetails } from '../send/send-destination';
import type { SparkLightningQuote } from '../send/spark-send-quote-service';

// The public send types are the domain entities for now: only the apps consume
// the SDK and they just read these shapes, so fields like proofs and userId
// ride along until a later slice narrows the surface (#1164).
export type { CashuSendQuote } from '../send/cashu-send-quote';
export type { CashuSendSwap };
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

export type GetCashuSendLightningQuoteParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The bolt11 invoice to pay. Amountless invoices are rejected for cashu accounts. */
  paymentRequest: string;
  /**
   * The amount the user entered, returned as `amountRequested`. The invoice
   * amount always determines what is paid.
   */
  amount?: Money;
};

export type CreateCashuSendQuoteParams = {
  /** The cashu account to send from. Must be the account the quote was created for. */
  account: CashuAccount;
  /** The lightning quote to create the send quote from (see `getLightningQuote`). */
  lightningQuote: CashuLightningQuote;
  /**
   * How the invoice was obtained (lightning address or contact), stored with
   * the send. Omit when paying a bolt11 directly.
   */
  destinationDetails?: DestinationDetails;
};
export type GetCashuSwapQuoteParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The amount the receiver should get, in the account's currency. */
  amount: Money;
};

export type CreateCashuSwapParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The amount the receiver should get, in the account's currency. */
  amount: Money;
};

export type CreateCashuSwapResult = {
  /** The created send swap; the token is produced in the background. */
  swap: CashuSendSwap;
};
export type GetSparkSendLightningQuoteParams = unknown; // step 15 (spark send quote)
export type CreateSparkSendQuoteParams = unknown; // step 15 (spark send quote)
