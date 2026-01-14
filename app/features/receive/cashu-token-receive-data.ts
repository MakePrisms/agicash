import { z } from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema for data related to cross-account cashu token receives.
 * Present only for TOKEN type quotes.
 */
export const CashuTokenReceiveDataSchema = z.object({
  /** URL of the source mint where the token proofs originate from. */
  sourceMintUrl: z.string(),
  /** The amount of the token melted. */
  tokenAmount: z.instanceof(Money),
  /** The proofs from the source cashu token that will be melted. */
  tokenProofs: z.array(ProofSchema),
  /** ID of the melt quote on the source mint. */
  meltQuoteId: z.string(),
  /** Whether the melt has been initiated on the source mint. */
  meltInitiated: z.boolean(),
  /** The fee that is paid for spending the token proofs as inputs to the melt operation. */
  cashuReceiveFee: z.instanceof(Money),
  /** The fee reserved for the lightning payment to melt the token proofs to this account. */
  lightningFeeReserve: z.instanceof(Money),
});

export type CashuTokenReceiveData = z.infer<typeof CashuTokenReceiveDataSchema>;
