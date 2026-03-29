import { z } from 'zod';
import { Money } from '../../lib/money';
import { CashuTokenMeltDataSchema } from './cashu-token-melt-data';

/**
 * Schema for the base Spark Lightning receive quote.
 * This is created when a user requests to receive funds via Lightning through their Spark wallet.
 */
const SparkReceiveQuoteBaseSchema = z.object({
  /**
   * UUID of the quote.
   */
  id: z.string(),
  /**
   * ID of the receive request in Spark system.
   */
  sparkId: z.string(),
  /**
   * Date and time the receive quote was created in ISO 8601 format.
   */
  createdAt: z.string(),
  /**
   * Date and time the receive quote expires in ISO 8601 format.
   */
  expiresAt: z.string(),
  /**
   * Amount of the quote.
   */
  amount: z.instanceof(Money),
  /**
   * Description of the receive.
   */
  description: z.string().optional(),
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * Optional public key of the wallet receiving the lightning invoice.
   */
  receiverIdentityPubkey: z.string().optional(),
  /**
   * UUID of the corresponding transaction.
   */
  transactionId: z.string(),
  /**
   * UUID of the user that the quote belongs to.
   */
  userId: z.string(),
  /**
   * UUID of the account that the quote belongs to.
   */
  accountId: z.string(),
  /**
   * The total fee for the transaction.
   * For receives of type LIGHTNING, this will be zero.
   * For receive of type CASHU_TOKEN, this will be the sum of the `cashuReceiveFee` and `lightningFeeReserve`.
   *
   * For CASHU_TOKEN receives, we are currently not returning the change to the user. If we ever do, the totalFee should be updated
   * to use lightningFee instead of lightningFeeReserve once actual fee is known.
   */
  totalFee: z.instanceof(Money),
  /**
   * Version of the receive quote.
   * Can be used for optimistic locking.
   */
  version: z.number(),
});

const SparkReceiveQuoteLightningTypeSchema = z.object({
  /**
   * Type of the receive.
   * LIGHTNING - The money is received via regular Lightning flow. User provides the lightning invoice to the payer who then pays the invoice.
   */
  type: z.literal('LIGHTNING'),
});

const SparkReceiveQuoteCashuTokenTypeSchema = z.object({
  /**
   * Type of the receive.
   * CASHU_TOKEN - The money is received as cashu token. User provides the cashu token and cashu proofs are then melted by the Agicash app and used to pay Spark lightning invoice.
   *               Used for receiving cashu tokens to Spark accounts.
   */
  type: z.literal('CASHU_TOKEN'),
  /**
   * Data related to cashu token receive.
   */
  tokenReceiveData: CashuTokenMeltDataSchema,
});

const SparkReceiveQuoteUnpaidExpiredStateSchema = z.object({
  /**
   * State of the spark receive quote.
   */
  state: z.enum(['UNPAID', 'EXPIRED']),
});

const SparkReceiveQuotePaidStateSchema = z.object({
  /**
   * State of the spark receive quote.
   */
  state: z.literal('PAID'),
  /**
   * Payment preimage.
   */
  paymentPreimage: z.string(),
  /**
   * Spark transfer ID.
   */
  sparkTransferId: z.string(),
});

const SparkReceiveQuoteFailedStateSchema = z.object({
  /**
   * State of the spark receive quote.
   */
  state: z.literal('FAILED'),
  /**
   * Reason for the failure.
   */
  failureReason: z.string(),
});

/**
 * Schema for Spark receive quote.
 */
export const SparkReceiveQuoteSchema = z.intersection(
  SparkReceiveQuoteBaseSchema,
  z.intersection(
    z.union([
      SparkReceiveQuoteLightningTypeSchema,
      SparkReceiveQuoteCashuTokenTypeSchema,
    ]),
    z.union([
      SparkReceiveQuoteUnpaidExpiredStateSchema,
      SparkReceiveQuotePaidStateSchema,
      SparkReceiveQuoteFailedStateSchema,
    ]),
  ),
);

export type SparkReceiveQuote = z.infer<typeof SparkReceiveQuoteSchema>;
