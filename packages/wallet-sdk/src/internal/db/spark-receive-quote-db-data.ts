import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

/** Schema for spark lightning receive db data (the jsonb `encrypted_data` column). */
export const SparkLightningReceiveDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  description: z.optional(z.string()),
  paymentPreimage: z.optional(z.string()),
  cashuTokenMeltData: z.optional(CashuTokenMeltDbDataSchema),
  totalFee: z.instanceof(Money),
});

export type SparkLightningReceiveDbData = z.infer<
  typeof SparkLightningReceiveDbDataSchema
>;
