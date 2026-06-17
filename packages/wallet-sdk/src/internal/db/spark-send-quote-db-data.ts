import { Money } from '@agicash/money';
import { z } from 'zod/mini';

/** Schema for spark lightning send db data (the jsonb `encrypted_data` column). */
export const SparkLightningSendDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  estimatedLightningFee: z.instanceof(Money),
  amountSpent: z.optional(z.instanceof(Money)),
  lightningFee: z.optional(z.instanceof(Money)),
  paymentPreimage: z.optional(z.string()),
});

export type SparkLightningSendDbData = z.infer<
  typeof SparkLightningSendDbDataSchema
>;
