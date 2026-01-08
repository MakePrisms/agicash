import type { Money } from '~/lib/money';

export type SparkSendQuoteDetailsBase = {
  /**
   * Amount that the receiver will receive.
   * This is the invoice amount in the currency of the account we are sending from.
   */
  amountToReceive: Money;
  /**
   * The estimated fee for the Lightning Network payment.
   * If the actual fee ends up being different than this estimate,
   * the completed transaction will reflect the actual fee paid.
   */
  estimatedFee: Money;
  /**
   * The bolt11 payment request.
   */
  paymentRequest: string;
};

export type PendingSparkSendQuoteDetails = SparkSendQuoteDetailsBase & {
  /**
   * The ID of the send request in Spark system.
   */
  sparkId: string;
  /**
   * The ID of the transfer in Spark system.
   */
  sparkTransferId: string;
  /**
   * The actual fee for the Lightning Network payment.
   */
  fee: Money;
  /**
   * This is the sum of `amountToReceive` and `fee`. This is the amount deducted from the account.
   */
  amountSpent: Money;
};

export type CompletedSparkSendQuoteDetails = PendingSparkSendQuoteDetails & {
  /**
   * The preimage of the lightning payment.
   */
  paymentPreimage: string;
};

export type SparkSendQuoteDetails =
  | SparkSendQuoteDetailsBase
  | PendingSparkSendQuoteDetails
  | CompletedSparkSendQuoteDetails;

type SparkSendQuoteBase = {
  /**
   * UUID of the quote.
   */
  id: string;
  /**
   * Date and time the send quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the send quote expires in ISO 8601 format.
   */
  expiresAt?: string | null;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
  /**
   * ID of the user that the quote belongs to.
   */
  userId: string;
  /**
   * ID of the account that the quote belongs to.
   */
  accountId: string;
  /**
   * Row version. Used for optimistic locking.
   */
  version: number;
  /**
   * Whether the payment request is amountless.
   * When true, the amount field contains the user-specified amount.
   */
  paymentRequestIsAmountless: boolean;
};

type SparkSendQuoteByState =
  | ({
      state: 'UNPAID';
    } & SparkSendQuoteDetailsBase)
  | ({
      state: 'PENDING';
    } & PendingSparkSendQuoteDetails)
  | ({
      state: 'COMPLETED';
    } & CompletedSparkSendQuoteDetails)
  | ({
      state: 'FAILED';
      /**
       * Reason for failure.
       */
      failureReason?: string;
      /**
       * The ID of the send request in Spark system.
       */
      sparkId?: string;
      /**
       * The ID of the transfer in Spark system.
       */
      sparkTransferId?: string;
      /**
       * The actual fee for the Lightning Network payment.
       */
      fee?: Money;
    } & SparkSendQuoteDetailsBase);

/**
 * Represents a Spark Lightning send quote.
 * This is created when a user confirms a lightning payment through their Spark wallet.
 * The quote starts in UNPAID state, transitions to PENDING when payment is initiated,
 * and finally to COMPLETED or FAILED based on the payment result.
 */
export type SparkSendQuote = SparkSendQuoteBase & SparkSendQuoteByState;

export type PendingSparkSendQuote = SparkSendQuote & { state: 'PENDING' };
