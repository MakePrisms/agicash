import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for spark lightning send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const SparkLightningSendDbDataSchema = z.object({
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * Amount that the receiver receives.
   */
  amountReceived: z.instanceof(Money),
  /**
   * Estimated fee for the lightning payment.
   */
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
   * Preimage of the lightning payment.
   * Will be set only when the send is completed.
   */
  paymentPreimage: z.string().optional(),
  /**
   * USDB amount debited from the USD wallet before conversion.
   * Set only for USD-account sends.
   */
  usdbDebited: z.instanceof(Money).optional(),
  /**
   * Sats obtained after USDB → sats conversion (the input to the Lightning payment).
   * Set only for USD-account sends, when the conversion has completed.
   */
  satsAfterConversion: z.instanceof(Money).optional(),
  /**
   * Conversion fee charged by Flashnet for the USDB → sats swap.
   * Set only for USD-account sends, when the conversion has completed.
   */
  conversionFee: z.instanceof(Money).optional(),
  /**
   * Actual slippage realised on the USDB → sats swap.
   * Set only for USD-account sends, when the conversion has completed.
   */
  slippageActual: z.instanceof(Money).optional(),
});

/**
 * Spark lightning send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type SparkLightningSendDbData = z.infer<
  typeof SparkLightningSendDbDataSchema
>;
