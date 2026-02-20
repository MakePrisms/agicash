import { z } from 'zod';
import { SparkLightningReceiveDbDataSchema } from '../../../db/json-models';
import { Money } from '../../../lib/money';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Schema for Spark lightning receive transaction that is not yet completed.
 */
export const IncompleteSparkLightningReceiveTransactionDetailsSchema = z.object(
  {
    /**
     * Bolt 11 payment request.
     */
    paymentRequest: z.string(),
    /**
     * The payment hash of the lightning invoice.
     */
    paymentHash: z.string(),
    /**
     * The ID of the receive request in Spark system.
     */
    sparkId: z.string(),
    /**
     * The description of the transaction.
     */
    description: z.string().optional(),
    /**
     * Amount credited to the account.
     * This is the amount of the bolt 11 payment request.
     */
    amount: z.instanceof(Money),
  },
);

export type IncompleteSparkLightningReceiveTransactionDetails = z.infer<
  typeof IncompleteSparkLightningReceiveTransactionDetailsSchema
>;

/**
 * Schema for completed Spark lightning receive transaction.
 */
export const CompletedSparkLightningReceiveTransactionDetailsSchema =
  IncompleteSparkLightningReceiveTransactionDetailsSchema.extend({
    /**
     * The payment preimage of the lightning payment.
     */
    paymentPreimage: z.string(),
    /**
     * The ID of the transfer in Spark system.
     */
    sparkTransferId: z.string(),
  });

export type CompletedSparkLightningReceiveTransactionDetails = z.infer<
  typeof CompletedSparkLightningReceiveTransactionDetailsSchema
>;

export const SparkLightningReceiveTransactionDetailsSchema = z.union([
  IncompleteSparkLightningReceiveTransactionDetailsSchema,
  CompletedSparkLightningReceiveTransactionDetailsSchema,
]);

export type SparkLightningReceiveTransactionDetails = z.infer<
  typeof SparkLightningReceiveTransactionDetailsSchema
>;

export const SparkLightningReceiveTransactionDetailsParser = z
  .object({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    transactionDetails: z.object({
      paymentHash: z.string(),
      sparkId: z.string(),
      sparkTransferId: z.string().optional(),
    }),
    decryptedTransactionDetails: SparkLightningReceiveDbDataSchema,
  })
  .transform(
    ({
      state,
      transactionDetails,
      decryptedTransactionDetails,
    }):
      | IncompleteSparkLightningReceiveTransactionDetails
      | CompletedSparkLightningReceiveTransactionDetails => {
      const incompleteDetails: IncompleteSparkLightningReceiveTransactionDetails =
        {
          paymentRequest: decryptedTransactionDetails.paymentRequest,
          paymentHash: transactionDetails.paymentHash,
          sparkId: transactionDetails.sparkId,
          description: decryptedTransactionDetails.description,
          amount: decryptedTransactionDetails.amountReceived,
        };

      if (state === 'COMPLETED') {
        return CompletedSparkLightningReceiveTransactionDetailsSchema.parse({
          ...incompleteDetails,
          // We can use as assertions here because parse will throw if the expectations are not met.
          paymentPreimage:
            decryptedTransactionDetails.paymentPreimage as string,
          sparkTransferId: transactionDetails.sparkTransferId as string,
        } satisfies z.input<
          typeof CompletedSparkLightningReceiveTransactionDetailsSchema
        >);
      }

      return incompleteDetails;
    },
  ) satisfies TransactionDetailsParserShape;
