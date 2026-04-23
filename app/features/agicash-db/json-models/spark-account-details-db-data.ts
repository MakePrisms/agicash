import { z } from 'zod';

export const SparkAccountDetailsDbDataSchema = z.object({
  /**
   * Network of the Spark account.
   * Based on the Breez SDK network type (stored as uppercase in the DB).
   */
  network: z.enum(['MAINNET', 'REGTEST']),
});

export type SparkAccountDetailsDbData = z.infer<
  typeof SparkAccountDetailsDbDataSchema
>;

export type SparkNetwork = SparkAccountDetailsDbData['network'];
