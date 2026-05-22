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
  /**
   * Sats received over Lightning before the stable_balance conversion runs.
   * Set only on USD-account receives, when the lightning leg has settled.
   */
  bolt11AmountSats: z.instanceof(Money).optional(),
  /**
   * Conversion fee charged by Flashnet for the sats→USDB swap.
   * Set only on USD-account receives, when the conversion has completed.
   */
  conversionFee: z.instanceof(Money).optional(),
  /**
   * Difference between the estimated and actual USDB output (price movement
   * within the configured slippage tolerance).
   * Set only on USD-account receives, when the conversion has completed.
   */
  slippageDelta: z.instanceof(Money).optional(),
  /**
   * USDB amount actually credited after conversion.
   * Set only on USD-account receives, when the conversion has completed.
   * Same as `amountReceived` once both legs are done, but kept separately
   * for accounting clarity vs the lightning-leg sats.
   */
  usdbAmountReceived: z.instanceof(Money).optional(),
});

/**
 * Spark lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type SparkLightningReceiveDbData = z.infer<
  typeof SparkLightningReceiveDbDataSchema
>;
