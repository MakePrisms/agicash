import type { Money } from '~/lib/money';

/**
 * Represents a Spark Lightning send quote.
 * This is created when a user confirms a lightning payment through their Spark wallet.
 * The quote starts in UNPAID state, transitions to PENDING when payment is initiated,
 * and finally to COMPLETED or FAILED based on the payment result.
 */
export type SparkSendQuote = {
  /**
   * UUID of the quote.
   */
  id: string;
  /**
   * ID of the send request in spark system.
   * This is null when the quote is in UNPAID state since the payment hasn't been initiated yet.
   */
  sparkId: string | null;
  /**
   * Date and time the send quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Amount being sent.
   */
  amount: Money;
  /**
   * Estimated fee for the lightning payment.
   */
  fee: Money;
  /**
   * Lightning invoice being paid.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
  /**
   * State of the spark send quote.
   */
  state: 'UNPAID' | 'PENDING' | 'COMPLETED' | 'FAILED';
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
} & (
  | {
      state: 'UNPAID';
    }
  | {
      state: 'PENDING';
      /**
       * ID of the send request in spark system.
       */
      sparkId: string;
    }
  | {
      state: 'COMPLETED';
      /**
       * ID of the send request in spark system.
       */
      sparkId: string;
      /**
       * Payment preimage proving the payment was successful.
       */
      paymentPreimage: string;
      /**
       * Spark transfer ID.
       */
      sparkTransferId: string;
    }
  | {
      state: 'FAILED';
      /**
       * Reason for failure.
       */
      failureReason?: string;
    }
);
