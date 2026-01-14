import z from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema for the data of a cashu token melted for the receive.
 */
export const CashuTokenDataSchema = z.object({
  /** The mint which issued the token. */
  tokenMintUrl: z.string(),
  /** ID of the melt quote that was executed to melt the cashu token to pay for the mint quote. */
  meltQuoteId: z.string(),
  /** The amount of the token melted. */
  tokenAmount: z.instanceof(Money),
  /** The proofs of cashu token melted. */
  tokenProofs: z.array(ProofSchema),
  /** The fee that is paid for spending the token proofs as inputs to the melt operation. */
  cashuReceiveFee: z.instanceof(Money),
  /** The fee reserved for the lightning payment to melt the token proofs to this account. */
  lightningFeeReserve: z.instanceof(Money),
  // TODO: I think we don't store actual ln fee after the melt for cross account cashu token receives
});

export type CashuTokenData = z.infer<typeof CashuTokenDataSchema>;
