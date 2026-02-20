import { SparkError } from '@buildonspark/spark-sdk';
import { z } from 'zod';

const InsufficentBalanceErrorContextSchema = z.object({
  expected: z.string(),
  field: z.string(),
  value: z.number(),
});

const InsufficentBalanceErrorSchema = z.object({
  getContext: z.function({
    input: [],
    output: InsufficentBalanceErrorContextSchema,
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
): error is z.infer<typeof InsufficentBalanceErrorSchema> & SparkError => {
  if (!(error instanceof SparkError)) {
    return false;
  }

  if (!InsufficentBalanceErrorSchema.safeParse(error).success) {
    return false;
  }

  const context = error.getContext();

  // We want to throw if they change the context shape that we expect.
  InsufficentBalanceErrorContextSchema.parse(context);

  return true;
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
