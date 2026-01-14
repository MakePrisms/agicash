import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for spark lightning send data.
 */
export const SparkLightningSendDataSchema = z.object({
  /** Bolt 11 payment request. */
  paymentRequest: z.string(),
  /** Amount that the receiver will receive. */
  amountToReceive: z.instanceof(Money),
  /** Estimated fee for the lightning payment. */
  estimatedLightningFee: z.instanceof(Money),
  /**
   * Amount spent on the send.
   * This is the amount to send plus the actual fee paid to the lightning network.
   * Available only when the send is initiated.
   */
  amountSpent: z.instanceof(Money).optional(),
  /**
   * The actual Lightning Network fee that was charged for the transaction.
   * Will be set only when the send is initiated.
   */
  lightningFee: z.instanceof(Money).optional(),
  /**
   * The actual fees for the transaction.
   * Equal to lightningFee.
   * Available only when the send is initiated.
   */
  totalFees: z.instanceof(Money).optional(),
  /**
   * Preimage of the lightning payment.
   * Will be set only when the send is completed.
   */
  paymentPreimage: z.string().optional(),
});

export type SparkLightningSendData = z.infer<
  typeof SparkLightningSendDataSchema
>;

export const SparkLightningSendNonSensitiveDataSchema = z.object({
  /**
   * The ID of the send request in Spark system.
   * Will be set only after the send is initiated.
   */
  sparkId: z.string().optional(),
  /**
   * The ID of the transfer in Spark system.
   * Will be set only after the send is initiated.
   */
  sparkTransferId: z.string().optional(),
});

export type SparkLightningSendNonSensitiveData = z.infer<
  typeof SparkLightningSendNonSensitiveDataSchema
>;
