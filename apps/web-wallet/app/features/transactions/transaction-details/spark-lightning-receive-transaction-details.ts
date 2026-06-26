import { Money } from '@agicash/money';
import { SparkLightningReceiveDbDataSchema } from '@agicash/wallet-sdk/temporary';
import { z } from 'zod/mini';
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
    description: z.optional(z.string()),
    /**
     * Amount credited to the account.
     * This is the amount of the bolt 11 payment request.
     */
    amount: z.instanceof(Money),
    /**
     * UUID linking paired send/receive transactions for internal transfers.
     */
    transferId: z.optional(z.string()),
  },
);

export type IncompleteSparkLightningReceiveTransactionDetails = z.infer<
  typeof IncompleteSparkLightningReceiveTransactionDetailsSchema
>;

/**
 * Schema for completed Spark lightning receive transaction.
 */
export const CompletedSparkLightningReceiveTransactionDetailsSchema = z.extend(
  IncompleteSparkLightningReceiveTransactionDetailsSchema,
  {
    /**
     * The payment preimage of the lightning payment.
     */
    paymentPreimage: z.string(),
    /**
     * The ID of the transfer in Spark system.
     */
    sparkTransferId: z.string(),
  },
);

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

export const SparkLightningReceiveTransactionDetailsParser = z.pipe(
  z.object({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    transactionDetails: z.object({
      paymentHash: z.string(),
      sparkId: z.string(),
      sparkTransferId: z.optional(z.string()),
      transferId: z.optional(z.string()),
    }),
    decryptedTransactionDetails: SparkLightningReceiveDbDataSchema,
  }),
  z.transform(
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
          transferId: transactionDetails.transferId,
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
  ),
) satisfies TransactionDetailsParserShape;
