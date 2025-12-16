import { SparkError } from '@buildonspark/spark-sdk';
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
): error is z.infer<typeof InsufficentBalanceErrorSchema> &
  Omit<SparkError, 'context'> => {
  return (
    error instanceof SparkError &&
    InsufficentBalanceErrorSchema.safeParse(error).success
  );
};

export const isInvoiceAlreadyPaidError = (
  error: unknown,
): error is SparkError => {
  return (
    error instanceof SparkError &&
    error.message.toLowerCase().includes('failed to initiate preimage swap') &&
    error.message.toLowerCase().includes('preimage request already exists')
  );
};
