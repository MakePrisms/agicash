import { z } from 'zod';
import { CashuAccountDetailsDbDataSchema } from './cashu-account-details-db-data';
import { SparkAccountDetailsDbDataSchema } from './spark-account-details-db-data';

export const AccountDetailsDbDataSchema = z.union([
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
]);

export type AccountDetailsDbData = z.infer<typeof AccountDetailsDbDataSchema>;
