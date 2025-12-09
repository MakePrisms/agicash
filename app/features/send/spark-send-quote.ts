import type { Money } from '~/lib/money';

/**
 * Represents a Spark Lightning send quote.
 * This is created when a user initiates a lightning payment through their Spark wallet.
 */
export type SparkSendQuote = {
  /**
   * UUID of the quote.
   */
  id: string;
  /**
   * ID of the send request in spark system.
   */
  sparkId: string;
  /**
   * Date and time the send quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Amount being sent.
   */
  amount: Money;
  /**
   * Fee for the lightning payment.
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
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
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
} & (
  | {
      state: 'PENDING';
    }
  | {
      state: 'COMPLETED';
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
