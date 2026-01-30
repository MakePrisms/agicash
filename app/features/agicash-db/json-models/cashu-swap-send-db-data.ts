import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for cashu swap send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const CashuSwapSendDbDataSchema = z.object({
  /**
   * The URL of the mint which issued the token.
   */
  tokenMintUrl: z.string(),
  /**
   * Amount received by the receiver.
   */
  amountReceived: z.instanceof(Money),
  /**
   * The swap fee that will be incurred when the receiver claims the token.
   */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * Amount that sender needs to create a token for in order for the receiver to receive exactly `amountReceived`.
   * This is `amountReceived` plus `cashuReceiveFee`.
   */
  amountToSend: z.instanceof(Money),
  /**
   * The swap fee that will be incurred when swapping the input proofs to get `amountToSend` worth of proofs to send.
   * When the `amountReserved` equals `amountToSend`, no swap is needed and this will be zero.
   */
  cashuSendFee: z.instanceof(Money),
  /**
   * The total amount spent for this send.
   * This is the sum of `amountToSend` and `cashuSendFee`.
   * While the swap is not completed, the account balance will show reservation debit that can be greater than this
   * amount (see `amountReserved`).
   */
  amountSpent: z.instanceof(Money),
  /**
   * Amount reserved for the send.
   * This is the sum of the input proofs and is greater or equal to `amountToSend`.
   * When the amount is greater, there is a swap made to get the `amountToSend` worth of proofs to send.
   * The change is returned to the source account.
   */
  amountReserved: z.instanceof(Money),
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuSendFee` and `cashuReceiveFee`.
   */
  totalFee: z.instanceof(Money),
  /**
   * The swap output amounts used for the send and change.
   * Will be defined only when the swap is needed (`inputAmount` is greater than the `amountToSend`).
   */
  outputAmounts: z
    .object({
      /**
       * The swap output amounts used for the send.
       * Proofs with these amounts are then used to create a token which is shared with the receiver.
       */
      send: z.array(z.number()),
      /**
       * The swap output amounts used for the change.
       * Proofs with these amounts are then returned to the source account as change.
       */
      change: z.array(z.number()),
    })
    .optional(),
});

/**
 * Cashu swap send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type CashuSwapSendDbData = z.infer<typeof CashuSwapSendDbDataSchema>;
