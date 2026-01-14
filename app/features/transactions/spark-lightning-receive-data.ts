import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuTokenDataSchema } from './cashu-token-data';

/**
 * Schema for spark lightning receive data.
 */
export const SparkLightningReceiveDataSchema = z.object({
  /** Bolt 11 payment request. */
  paymentRequest: z.string(),
  /** The amount credited to the account. */
  amountReceived: z.instanceof(Money),
  /** The description of the transaction. */
  description: z.string().optional(),
  /**
   * The payment preimage of the lightning payment.
   * Will be set only when the receive quote gets paid.
   */
  paymentPreimage: z.string().optional(),
  /**
   * The data of the cashu token melted for the receive.
   * This will be set only for cashu token receives to spark accounts.
   */
  cashuTokenData: CashuTokenDataSchema.optional(),
  /**
   * The total fees for the transaction.
   * For lightning receives this will be zero.
   * For cashu token receives over lightning, this will be the sum of the cashuReceiveFee and lightningFeeReserve.
   * TODO: should we update this with actual ln fee when known?
   */
  totalFees: z.instanceof(Money),
});

export type SparkLightningReceiveData = z.infer<
  typeof SparkLightningReceiveDataSchema
>;

export const SparkLightningReceiveNonSensitiveDataSchema = z.object({
  /**
   * The ID of the receive request in Spark system.
   */
  sparkId: z.string(),
  /**
   * The ID of the transfer in Spark system.
   * Will be set only after the receive is completed.
   */
  sparkTransferId: z.string().optional(),
});

export type SparkLightningReceiveNonSensitiveData = z.infer<
  typeof SparkLightningReceiveNonSensitiveDataSchema
>;
