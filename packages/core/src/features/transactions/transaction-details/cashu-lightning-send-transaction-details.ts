import { z } from 'zod';
import { CashuLightningSendDbDataSchema } from '../../../db/json-models';
import { Money } from '../../../lib/money';
import { DestinationDetailsSchema } from '../../send/cashu-send-quote';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Base schema for cashu lightning send transaction details.
 */
export const IncompleteCashuLightningSendTransactionDetailsSchema = z.object({
  /**
   * The bolt11 payment request the the transaction is paying.
   */
  paymentRequest: z.string(),
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * Additional details related to the transaction.
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails: DestinationDetailsSchema.optional(),
  /**
   * The amount reserved for the send.
   * This is the sum of all proofs used as inputs to the cashu melt operation.
   * These proofs are reserved until the send is completed or failed.
   * When the send is completed, the change is returned to the account.
   */
  amountReserved: z.instanceof(Money),
  /**
   * Amount that the receiver receives.
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do
   * the conversion using their exchange rate at the time of quote creation.
   */
  amountReceived: z.instanceof(Money),
  /**
   * The amount reserved to cover the maximum potential Lightning Network fee.
   * If the actual Lightning fee ends up being lower than this reserve,
   * the difference is returned as change to the user.
   */
  lightningFeeReserve: z.instanceof(Money),
  /**
   * The fee incurred to spend the proofs in the cashu melt operation.
   */
  cashuSendFee: z.instanceof(Money),
  /**
   * Estimated total fee for the transaction.
   * This is the sum of `lightningFeeReserve` and `cashuSendFee` and is the max potential fee for the transaction.
   */
  estimatedTotalFee: z.instanceof(Money),
  /**
   * The amount debited from the account.
   * When the transaction is not completed, this is equal to `amountReserved`.
   * When the transaction is completed, this is equal to the sum of `amountReceived` and `totalFee`.
   * This is the sum of `amountReceived` and `totalFee`.
   */
  amount: z.instanceof(Money),
});

export type IncompleteCashuLightningSendTransactionDetails = z.infer<
  typeof IncompleteCashuLightningSendTransactionDetailsSchema
>;

/**
 * Schema for completed cashu lightning send transaction.
 */
export const CompletedCashuLightningSendTransactionDetailsSchema =
  IncompleteCashuLightningSendTransactionDetailsSchema.extend({
    /**
     * The preimage of the lightning payment.
     * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'
     */
    preimage: z.string(),
    /**
     * The actual Lightning Network fee that was charged after the transaction completed.
     * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
     * The difference between `lightningFeeReserve` and `lightningFee`, along with any overpaid inputs, is returned as change to the user.
     */
    lightningFee: z.instanceof(Money),
    /**
     * The total fee for the transaction.
     * This is the sum of `lightningFee` and `cashuSendFee`.
     */
    totalFee: z.instanceof(Money),
  });

export type CompletedCashuLightningSendTransactionDetails = z.infer<
  typeof CompletedCashuLightningSendTransactionDetailsSchema
>;

export const CashuLightningSendTransactionDetailsSchema = z.union([
  IncompleteCashuLightningSendTransactionDetailsSchema,
  CompletedCashuLightningSendTransactionDetailsSchema,
]);

export type CashuLightningSendTransactionDetails = z.infer<
  typeof CashuLightningSendTransactionDetailsSchema
>;

export const CashuLightningSendTransactionDetailsParser = z
  .object({
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('SEND'),
    state: TransactionStateSchema,
    transactionDetails: z.object({
      paymentHash: z.string(),
    }),
    decryptedTransactionDetails: CashuLightningSendDbDataSchema,
  })
  .transform(
    ({
      state,
      transactionDetails,
      decryptedTransactionDetails,
    }):
      | IncompleteCashuLightningSendTransactionDetails
      | CompletedCashuLightningSendTransactionDetails => {
      const incompleteDetails: IncompleteCashuLightningSendTransactionDetails =
        {
          paymentRequest: decryptedTransactionDetails.paymentRequest,
          paymentHash: transactionDetails.paymentHash,
          destinationDetails: decryptedTransactionDetails.destinationDetails,
          amountReserved: decryptedTransactionDetails.amountReserved,
          amountReceived: decryptedTransactionDetails.amountReceived,
          lightningFeeReserve: decryptedTransactionDetails.lightningFeeReserve,
          cashuSendFee: decryptedTransactionDetails.cashuSendFee,
          estimatedTotalFee:
            decryptedTransactionDetails.lightningFeeReserve.add(
              decryptedTransactionDetails.cashuSendFee,
            ),
          amount: decryptedTransactionDetails.amountReserved,
        };

      if (state === 'COMPLETED') {
        return CompletedCashuLightningSendTransactionDetailsSchema.parse({
          ...incompleteDetails,
          // We can use as assertions here because parse will throw if the expectations are not met.
          preimage: decryptedTransactionDetails.paymentPreimage as string,
          lightningFee: decryptedTransactionDetails.lightningFee as Money,
          amount: decryptedTransactionDetails.amountSpent as Money,
          totalFee: decryptedTransactionDetails.totalFee as Money,
        } satisfies z.input<
          typeof CompletedCashuLightningSendTransactionDetailsSchema
        >);
      }

      return incompleteDetails;
    },
  ) satisfies TransactionDetailsParserShape;
