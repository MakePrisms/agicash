import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Base schema for Spark Lightning send quote.
 * This is created when a user confirms a lightning payment through their Spark wallet.
 * The quote starts in UNPAID state, transitions to PENDING when payment is initiated,
 * and finally to COMPLETED or FAILED based on the payment result.
 */
const SparkSendQuoteBaseSchema = z.object({
  /**
   * UUID of the quote.
   */
  id: z.string(),
  /**
   * Date and time the send quote was created in ISO 8601 format.
   */
  createdAt: z.string(),
  /**
   * Date and time the send quote expires in ISO 8601 format.
   */
  expiresAt: z.string().nullish(),
  /**
   * Amount being sent.
   */
  amount: z.instanceof(Money),
  /**
   * Estimated fee for the lightning payment.
   */
  estimatedFee: z.instanceof(Money),
  /**
   * Lightning invoice being paid.
   */
  paymentRequest: z.string(),
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * ID of the corresponding transaction.
   */
  transactionId: z.string(),
  /**
   * ID of the user that the quote belongs to.
   */
  userId: z.string(),
  /**
   * ID of the account that the quote belongs to.
   */
  accountId: z.string(),
  /**
   * Row version. Used for optimistic locking.
   */
  version: z.number(),
  /**
   * Whether the payment request is amountless.
   * When true, the amount field contains the user-specified amount.
   */
  paymentRequestIsAmountless: z.boolean(),
});

const SparkSendQuoteUnpaidStateSchema = z.object({
  state: z.literal('UNPAID'),
});

const SparkSendQuotePendingStateSchema = z.object({
  state: z.literal('PENDING'),
  /**
   * ID of the send request in spark system.
   */
  sparkId: z.string(),
  /**
   * Spark transfer ID.
   */
  sparkTransferId: z.string(),
  /**
   * Actual fee of the lightning payment.
   */
  fee: z.instanceof(Money),
});

const SparkSendQuoteCompletedStateSchema = z.object({
  state: z.literal('COMPLETED'),
  /**
   * ID of the send request in spark system.
   */
  sparkId: z.string(),
  /**
   * Spark transfer ID.
   */
  sparkTransferId: z.string(),
  /**
   * Actual fee of the lightning payment.
   */
  fee: z.instanceof(Money),
  /**
   * Payment preimage proving the payment was successful.
   */
  paymentPreimage: z.string(),
});

const SparkSendQuoteFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  /**
   * Reason for failure.
   */
  failureReason: z.string(),
  /**
   * ID of the send request in spark system.
   */
  sparkId: z.string().optional(),
  /**
   * Spark transfer ID.
   */
  sparkTransferId: z.string().optional(),
  /**
   * Actual fee of the lightning payment.
   */
  fee: z.instanceof(Money).optional(),
});

/**
 * Schema for Spark Lightning send quote.
 */
export const SparkSendQuoteSchema = z.intersection(
  SparkSendQuoteBaseSchema,
  z.union([
    SparkSendQuoteUnpaidStateSchema,
    SparkSendQuotePendingStateSchema,
    SparkSendQuoteCompletedStateSchema,
    SparkSendQuoteFailedStateSchema,
  ]),
);

export type SparkSendQuote = z.infer<typeof SparkSendQuoteSchema>;
