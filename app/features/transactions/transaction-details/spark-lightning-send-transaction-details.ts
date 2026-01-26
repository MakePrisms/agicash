import { z } from 'zod';
import { SparkLightningSendDbDataSchema } from '~/features/agicash-db/json-models';
import { Money } from '~/lib/money';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Schema for a Spark lightning send transaction that is not yet completed.
 */
export const IncompleteSparkLightningSendTransactionDetailsSchema = z.object({
  /**
   * Amount that the receiver receives.
   * This is the invoice amount in the currency of the account we are sending from.
   */
  amountReceived: z.instanceof(Money),
  /**
   * The estimated fee for the Lightning Network payment.
   * If the actual fee ends up being different than this estimate, the completed transaction will reflect the actual fee paid.
   */
  estimatedFee: z.instanceof(Money),
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * The payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * Amount debited from the account.
   * While the transaction is not initiated yet and actual fee is not known, this will be the sum of `amountReceived` and `estimatedFee`.
   * This should be a very brief period of time, since the payment is initiated immediately after the quote is created.
   * When the transaction is initiated, and the actual fee is known, this will be the sum of `amountReceived` and `totalFee`.
   */
  amount: z.instanceof(Money),
  /**
   * The actual fee for the transaction.
   * While the transaction is not initiated yet and actual fee is not known, this will be equal to `estimatedFee`.
   * This should be a very brief period of time, since the payment is initiated immediately after the quote is created.
   * Once the transaction is initiated, this will be set to actual fee spent for the transaction.
   */
  fee: z.instanceof(Money),
  /**
   * The ID of the send request in Spark system.
   * Available after the payment is initiated.
   */
  sparkId: z.string().optional(),
  /**
   * The ID of the transfer in Spark system.
   * Available after the payment is initiated.
   */
  sparkTransferId: z.string().optional(),
});

export type IncompleteSparkLightningSendTransactionDetails = z.infer<
  typeof IncompleteSparkLightningSendTransactionDetailsSchema
>;

/**
 * Schema for a Spark lightning send transaction that is completed.
 */
export const CompletedSparkLightningSendTransactionDetailsSchema =
  IncompleteSparkLightningSendTransactionDetailsSchema.required().extend({
    /** The preimage of the lightning payment. */
    paymentPreimage: z.string(),
  });

export type CompletedSparkLightningSendTransactionDetails = z.infer<
  typeof CompletedSparkLightningSendTransactionDetailsSchema
>;

export const SparkLightningSendTransactionDetailsSchema = z.union([
  IncompleteSparkLightningSendTransactionDetailsSchema,
  CompletedSparkLightningSendTransactionDetailsSchema,
]);

export type SparkLightningSendTransactionDetails = z.infer<
  typeof SparkLightningSendTransactionDetailsSchema
>;

export const SparkLightningSendTransactionDetailsParser = z
  .object({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('SEND'),
    state: TransactionStateSchema,
    transactionDetails: z.object({
      paymentHash: z.string(),
      sparkId: z.string().optional(),
      sparkTransferId: z.string().optional(),
    }),
    decryptedTransactionDetails: SparkLightningSendDbDataSchema,
  })
  .transform(
    ({
      state,
      transactionDetails,
      decryptedTransactionDetails,
    }):
      | IncompleteSparkLightningSendTransactionDetails
      | CompletedSparkLightningSendTransactionDetails => {
      const incompleteDetails: IncompleteSparkLightningSendTransactionDetails =
        {
          amountReceived: decryptedTransactionDetails.amountReceived,
          estimatedFee: decryptedTransactionDetails.estimatedLightningFee,
          paymentRequest: decryptedTransactionDetails.paymentRequest,
          paymentHash: transactionDetails.paymentHash,
          amount:
            decryptedTransactionDetails.amountSpent ??
            decryptedTransactionDetails.amountReceived.add(
              decryptedTransactionDetails.estimatedLightningFee,
            ),
          sparkId: transactionDetails.sparkId,
          sparkTransferId: transactionDetails.sparkTransferId,
          fee:
            decryptedTransactionDetails.lightningFee ??
            decryptedTransactionDetails.estimatedLightningFee,
        };

      if (state === 'COMPLETED') {
        return CompletedSparkLightningSendTransactionDetailsSchema.parse({
          ...incompleteDetails,
          // We can use as assertions here because parse will throw if the expectations are not met.
          sparkId: transactionDetails.sparkId as string,
          sparkTransferId: transactionDetails.sparkTransferId as string,
          paymentPreimage:
            decryptedTransactionDetails.paymentPreimage as string,
        } satisfies z.input<
          typeof CompletedSparkLightningSendTransactionDetailsSchema
        >);
      }

      return incompleteDetails;
    },
  ) satisfies TransactionDetailsParserShape;
