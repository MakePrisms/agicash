import { z } from 'zod';
import { CashuSwapSendDbDataSchema } from '~/features/agicash-db/json-models';
import { Money } from '~/lib/money';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Schema for cashu token send transaction.
 */
export const CashuTokenSendTransactionDetailsSchema = z.object({
  /**
   * The amount of the token sent.
   * This is the sum of `amountReceived` and `cashuReceiveFee`.
   */
  tokenAmount: z.instanceof(Money),
  /**
   * The URL of the mint that issued the token.
   */
  tokenMintUrl: z.string(),
  /**
   * Amount reserved for the send.
   * This is the sum of the input proofs and is greater or equal to `tokenAmount`.
   * When the source account doesn't have the exact amount of proofs required for `tokenAmount`, the transaction requires
   * a swap, which then also incurs `cashuSendFee`. When this happens this amount is greater than the `amountReceived`
   * plus `totalFee`.
   */
  amountReserved: z.instanceof(Money),
  /**
   * Amount debited from the account.
   * When the transaction doesn't require a swap, this will be equal to `amountReserved`.
   * When the transaction requires a swap, this will be equal to `amountReserved` until the swap is completed.
   * After the swap is completed, this will be equal to the amount actually spent (`amountReceived` plus `totalFee`).
   * Change is returned to the source account when the swap is completed.
   */
  amount: z.instanceof(Money),
  /**
   * Amount that the recipient receives.
   * This is `amount` minus `totalFee`.
   */
  amountReceived: z.instanceof(Money),
  /**
   * The fee that we include in the token for the receiver to claim exactly `amountReceived`.
   */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The swap fee that will be incurred when swapping the input proofs to get `tokenAmount` worth of proofs to send.
   * When the `amountReserved` equals `tokenAmount`, no swap is needed and this will be zero.
   */
  cashuSendFee: z.instanceof(Money),
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuSendFee` and `cashuReceiveFee`.
   */
  totalFee: z.instanceof(Money),
});

export type CashuTokenSendTransactionDetails = z.infer<
  typeof CashuTokenSendTransactionDetailsSchema
>;

export const CashuTokenSendTransactionDetailsParser = z
  .object({
    type: z.literal('CASHU_TOKEN'),
    direction: z.literal('SEND'),
    state: TransactionStateSchema,
    decryptedTransactionDetails: CashuSwapSendDbDataSchema,
  })
  .transform(
    ({
      state,
      decryptedTransactionDetails,
    }): CashuTokenSendTransactionDetails => {
      return {
        tokenAmount: decryptedTransactionDetails.amountToSend,
        tokenMintUrl: decryptedTransactionDetails.tokenMintUrl,
        amountReserved: decryptedTransactionDetails.amountReserved,
        amount:
          state === 'COMPLETED'
            ? decryptedTransactionDetails.amountSpent
            : decryptedTransactionDetails.amountReserved,
        amountReceived: decryptedTransactionDetails.amountReceived,
        cashuReceiveFee: decryptedTransactionDetails.cashuReceiveFee,
        cashuSendFee: decryptedTransactionDetails.cashuSendFee,
        totalFee: decryptedTransactionDetails.totalFee,
      };
    },
  ) satisfies TransactionDetailsParserShape;
