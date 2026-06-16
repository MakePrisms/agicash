import type { CashuTokenMeltData } from './cashu';
/**
 * Spark quote domain types — §6 of the contract.
 *
 * Lifted verbatim (as the zod/mini `z.infer` shapes) from:
 *   - `app/features/send/spark-send-quote.ts`      (SparkSendQuote)
 *   - `app/features/receive/spark-receive-quote.ts` (SparkReceiveQuote)
 */
import type { Money } from './money';

// ---------------------------------------------------------------------------
// Spark send — SparkSendQuote (UNPAID/PENDING/COMPLETED/FAILED)
// ---------------------------------------------------------------------------

type SparkSendQuoteBase = {
  /** UUID of the quote. */
  id: string;
  /** Date and time the send quote was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the send quote expires in ISO 8601 format. */
  expiresAt?: string | null;
  /** Amount being sent. */
  amount: Money;
  /** Estimated fee for the lightning payment. */
  estimatedFee: Money;
  /** Lightning invoice being paid. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** ID of the corresponding transaction. */
  transactionId: string;
  /** ID of the user that the quote belongs to. */
  userId: string;
  /** ID of the account that the quote belongs to. */
  accountId: string;
  /** Row version. Used for optimistic locking. */
  version: number;
  /**
   * Whether the payment request is amountless.
   * When true, the amount field contains the user-specified amount.
   */
  paymentRequestIsAmountless: boolean;
};

/**
 * A Spark Lightning send quote (`send/spark-send-quote.ts`).
 * Created when a user confirms a lightning payment through their Spark wallet.
 * The quote starts in UNPAID state, transitions to PENDING when payment is initiated,
 * and finally to COMPLETED or FAILED based on the payment result.
 */
export type SparkSendQuote = SparkSendQuoteBase &
  (
    | { state: 'UNPAID' }
    | {
        state: 'PENDING';
        /** ID of the send request in spark system. */
        sparkId: string;
        /** Spark transfer ID. */
        sparkTransferId: string;
        /** Actual fee of the lightning payment. */
        fee: Money;
      }
    | {
        state: 'COMPLETED';
        /** ID of the send request in spark system. */
        sparkId: string;
        /** Spark transfer ID. */
        sparkTransferId: string;
        /** Actual fee of the lightning payment. */
        fee: Money;
        /** Payment preimage proving the payment was successful. */
        paymentPreimage: string;
      }
    | {
        state: 'FAILED';
        /** Reason for failure. */
        failureReason: string;
        /** ID of the send request in spark system. */
        sparkId?: string;
        /** Spark transfer ID. */
        sparkTransferId?: string;
        /** Actual fee of the lightning payment. */
        fee?: Money;
      }
  );

// ---------------------------------------------------------------------------
// Spark receive — SparkReceiveQuote (type LIGHTNING|CASHU_TOKEN ∧ state)
// ---------------------------------------------------------------------------

type SparkReceiveQuoteBase = {
  /** UUID of the quote. */
  id: string;
  /** ID of the receive request in Spark system. */
  sparkId: string;
  /** Date and time the receive quote was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the receive quote expires in ISO 8601 format. */
  expiresAt: string;
  /** Amount of the quote. */
  amount: Money;
  /** Description of the receive. */
  description?: string;
  /** Bolt 11 payment request. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** Optional public key of the wallet receiving the lightning invoice. */
  receiverIdentityPubkey?: string;
  /** UUID of the corresponding transaction. */
  transactionId: string;
  /** UUID of the user that the quote belongs to. */
  userId: string;
  /** UUID of the account that the quote belongs to. */
  accountId: string;
  /**
   * The total fee for the transaction.
   * For receives of type LIGHTNING, this will be zero.
   * For receive of type CASHU_TOKEN, this will be the sum of the `cashuReceiveFee` and `lightningFeeReserve`.
   *
   * For CASHU_TOKEN receives, we are currently not returning the change to the user. If we ever do, the totalFee should be updated
   * to use lightningFee instead of lightningFeeReserve once actual fee is known.
   */
  totalFee: Money;
  /**
   * Version of the receive quote.
   * Can be used for optimistic locking.
   */
  version: number;
};

/**
 * A Spark receive quote (`receive/spark-receive-quote.ts`).
 * Created when a user requests to receive funds via Lightning through their Spark wallet.
 * Two orthogonal discriminators: `type` (LIGHTNING vs CASHU_TOKEN) ∧ `state`
 * (UNPAID/EXPIRED, PAID, FAILED). A CASHU_TOKEN receive melts a provided cashu token
 * to pay the Spark Lightning invoice.
 */
export type SparkReceiveQuote = SparkReceiveQuoteBase &
  (
    | {
        /** The money is received via regular Lightning flow. User provides the lightning invoice to the payer who then pays the invoice. */
        type: 'LIGHTNING';
      }
    | {
        /**
         * The money is received as cashu token. User provides the cashu token and cashu proofs are then melted by the Agicash app and used to pay Spark lightning invoice.
         * Used for receiving cashu tokens to Spark accounts.
         */
        type: 'CASHU_TOKEN';
        /** Data related to cashu token receive. */
        tokenReceiveData: CashuTokenMeltData;
      }
  ) &
  (
    | { state: 'UNPAID' | 'EXPIRED' }
    | {
        state: 'PAID';
        /** Payment preimage. */
        paymentPreimage: string;
        /** Spark transfer ID. */
        sparkTransferId: string;
      }
    | {
        state: 'FAILED';
        /** Reason for the failure. */
        failureReason: string;
      }
  );
