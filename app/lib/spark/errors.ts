import { SparkSDKError } from '@buildonspark/spark-sdk';
import { z } from 'zod';

const InsufficentBalanceErrorSchema = z.object({
  context: z.object({
    expected: z.string(),
    field: z.string(),
    value: z.number(),
  }),
  message: z
    .string()
    .refine(
      (message) => message.toLowerCase().includes('insufficient balance'),
      { error: 'Not an insufficent balance error message' },
    ),
});

export const isInsufficentBalanceError = (
  error: unknown,
): error is SparkSDKError & z.infer<typeof InsufficentBalanceErrorSchema> => {
  return (
    error instanceof SparkSDKError &&
    InsufficentBalanceErrorSchema.safeParse(error).success
  );
};

export const isInvoiceAlreadyPaidError = (
  error: unknown,
): error is SparkSDKError => {
  return (
    error instanceof SparkSDKError &&
    error.message.toLowerCase().includes('failed to initiate preimage swap') &&
    error.message.toLowerCase().includes('preimage request already exists')
  );
};
