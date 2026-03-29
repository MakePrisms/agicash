import { z } from 'zod';

export const SparkAccountDetailsDbDataSchema = z.object({
  /**
   * Network of the Spark account.
   * Based on the NetworkType enum from the spark-sdk.
   */
  network: z.enum(['MAINNET', 'TESTNET', 'SIGNET', 'REGTEST', 'LOCAL']),
});

export type SparkAccountDetailsDbData = z.infer<
  typeof SparkAccountDetailsDbDataSchema
>;
