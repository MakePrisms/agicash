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

export type SparkNetwork = SparkAccountDetailsDbData['network'];

export function toBreezNetwork(network: SparkNetwork): 'mainnet' | 'regtest' {
  switch (network) {
    case 'MAINNET':
      return 'mainnet';
    case 'REGTEST':
    case 'LOCAL':
      return 'regtest';
    default:
      throw new Error(`Unsupported Spark network for Breez SDK: ${network}`);
  }
}
