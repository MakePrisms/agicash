import { z } from 'zod';
import { CashuLightningReceiveDbDataSchema } from '../../../db/json-models';
import { Money } from '../../../lib/money';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Schema for receiving cashu lightning payments to an account.
 */
export const CashuLightningReceiveTransactionDetailsSchema = z.object({
  /**
   * The bolt11 payment request.
   * If the mint has a minting fee, the amount in the payment request will be a sum of `amount` and `mintingFee`.
   */
  paymentRequest: z.string(),
  /**
   * The payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * The description of the transaction.
   */
  description: z.string().optional(),
  /**
   * Optional fee charged by the mint to deposit money into the account.
   * The payer of the lightning invoice pays this fee.
   */
  mintingFee: z.instanceof(Money).optional(),
  /**
   * The amount credited to the account.
   */
  amount: z.instanceof(Money),
  /**
   * The total fee for the receive.
   * In this case it is equal to `mintingFee` or zero if the mint has no minting fee.
   */
  totalFee: z.instanceof(Money),
});

export type CashuLightningReceiveTransactionDetails = z.infer<
  typeof CashuLightningReceiveTransactionDetailsSchema
>;

export const CashuLightningReceiveTransactionDetailsParser = z
  .object({
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    transactionDetails: z.object({
      paymentHash: z.string(),
    }),
    decryptedTransactionDetails: CashuLightningReceiveDbDataSchema,
  })
  .transform(
    ({
      transactionDetails,
      decryptedTransactionDetails,
    }): CashuLightningReceiveTransactionDetails => {
      return {
        paymentRequest: decryptedTransactionDetails.paymentRequest,
        paymentHash: transactionDetails.paymentHash,
        description: decryptedTransactionDetails.description,
        mintingFee: decryptedTransactionDetails.mintingFee,
        amount: decryptedTransactionDetails.amountReceived,
        totalFee: decryptedTransactionDetails.totalFee,
      };
    },
  ) satisfies TransactionDetailsParserShape;
