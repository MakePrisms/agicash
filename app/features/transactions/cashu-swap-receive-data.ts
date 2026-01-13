import z from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema for cashu swap receive data.
 */
export const CashuSwapReceiveDataSchema = z.object({
  /** The mint which issued the token being swapped. */
  tokenMintUrl: z.string(),
  /** The amount of the token being swapped. */
  tokenAmount: z.instanceof(Money),
  /** The proofs of cashu token being swapped. */
  tokenProofs: z.array(ProofSchema),
  /** The amount credited to the account. */
  amountReceived: z.instanceof(Money),
  /** Amounts for each blinded message created for this receive. */
  outputAmounts: z.array(z.number()),
  /** The fee that is paid for spending the token proofs as inputs to the swap operation. */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The total fees for the transaction.
   * In this case, it is equal to the cashuReceiveFee.
   */
  totalFees: z.instanceof(Money), // TODO: do we need this since it is equal to the cashuReceiveFee?
});

export type CashuSwapReceiveData = z.infer<typeof CashuSwapReceiveDataSchema>;
