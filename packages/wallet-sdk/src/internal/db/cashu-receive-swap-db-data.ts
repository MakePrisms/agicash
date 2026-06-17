import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { ProofSchema } from '../lib/cashu';

/**
 * Schema for cashu swap receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const CashuSwapReceiveDbDataSchema = z.object({
  /**
   * The mint which issued the token being swapped.
   */
  tokenMintUrl: z.string(),
  /**
   * The amount of the token being swapped.
   */
  tokenAmount: z.instanceof(Money),
  /**
   * The proofs of cashu token being swapped.
   */
  tokenProofs: z.array(ProofSchema),
  /**
   * The description (memo) of the token being swapped.
   */
  tokenDescription: z.optional(z.string()),
  /**
   * The amount credited to the account.
   */
  amountReceived: z.instanceof(Money),
  /**
   * Amounts for each blinded message created for this receive.
   */
  outputAmounts: z.array(z.number()),
  /**
   * The fee that is paid for spending the token proofs as inputs to the swap operation.
   */
  cashuReceiveFee: z.instanceof(Money),
});

/*
 * Cashu swap receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type CashuSwapReceiveDbData = z.infer<
  typeof CashuSwapReceiveDbDataSchema
>;
