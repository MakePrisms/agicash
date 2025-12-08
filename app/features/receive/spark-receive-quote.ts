import type { Money } from '~/lib/money';

/**
 * Represents a Spark Lightning receive quote.
 * This is created when a user requests to receive funds via Lightning through their Spark wallet.
 */
export type SparkReceiveQuote = {
  /**
   * UUID of the quote.
   */
  id: string;
  /**
   * ID of the receive request in spark system.
   */
  sparkId: string;
  /**
   * Date and time the receive quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the receive quote expires in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * Lightning invoice to be paid.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Optional public key of the wallet receiving the lightning invoice.
   */
  receiverIdentityPubkey?: string;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
  /**
   * Type of the receive.
   * LIGHTNING - The money is received via regular Lightning flow. User provides the lightning invoice to the payer who then pays the invoice.
   * CASHU_TOKEN - The money is received as cashu token. User provides the cashu token and cashu proofs are then melted by the Agicash app and used to pay Spark lightning invoice.
   *               Used for receiving cashu tokens to Spark accounts.
   */
  type: 'LIGHTNING' | 'CASHU_TOKEN';
  /**
   * State of the spark receive quote.
   */
  state: 'UNPAID' | 'EXPIRED' | 'PAID';
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
      state: 'UNPAID' | 'EXPIRED';
    }
  | {
      state: 'PAID';
      /**
       * Payment preimage.
       */
      paymentPreimage: string;
      /**
       * Spark transfer ID.
       */
      sparkTransferId: string;
    }
);
