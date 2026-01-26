import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

/**
 * Schema for spark lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const SparkLightningReceiveDbDataSchema = z.object({
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * The amount credited to the account.
   */
  amountReceived: z.instanceof(Money),
  /**
   * The description of the transaction.
   */
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
  cashuTokenMeltData: CashuTokenMeltDbDataSchema.optional(),
  /**
   * The total fee for the transaction.
   * For lightning receives this will be zero.
   * For cashu token receives over lightning, this will be the sum of `cashuReceiveFee` and `lightningFeeReserve`.
   *
   * We are currently not returning the change to the user for cashu token receives over lightning.
   * If we ever do, the totalFee should be updated to use lightningFee instead of lightningFeeReserve once actual
   * fee is known.
   */
  totalFee: z.instanceof(Money),
});

/**
 * Spark lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type SparkLightningReceiveDbData = z.infer<
  typeof SparkLightningReceiveDbDataSchema
>;
