import { z } from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema of the db data for a cashu token melted for the receive.
 * Defines the format of the data stored in the jsonb database column.
 */
export const CashuTokenMeltDbDataSchema = z.object({
  /**
   * The mint which issued the token.
   */
  tokenMintUrl: z.string(),
  /**
   * ID of the melt quote that was executed to melt the cashu token to pay for the mint quote.
   */
  meltQuoteId: z.string(),
  /**
   * The amount of the token melted.
   */
  tokenAmount: z.instanceof(Money),
  /**
   * The proofs of cashu token melted.
   */
  tokenProofs: z.array(ProofSchema),
  /**
   * The fee that is paid for spending the token proofs as inputs to the melt operation.
   */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The fee reserved for the lightning payment to melt the token proofs to this account.
   *
   * For cashu token receives over lightning, we are currently not returning the change to the user
   * which is why this data schema only has `lightningFeeReserve` and no actual `lightningFee`.
   */
  lightningFeeReserve: z.instanceof(Money),
});

/**
 * Db data for a cashu token melted for the receive.
 * Defines the format of the data stored in the jsonb database column.
 */
export type CashuTokenMeltDbData = z.infer<typeof CashuTokenMeltDbDataSchema>;
