import { z } from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema for the data of a cashu token melted for the receive.
 */
const CashuTokenDataSchema = z.object({
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

/**
 * Schema for cashu lightning receive data.
 */
export const CashuLightningReceiveDataSchema = z.object({
  /** Bolt 11 payment request. */
  paymentRequest: z.string(),
  /** ID of the mint quote for this receive. */
  mintQuoteId: z.string(),
  /** The amount credited to the account. */
  amountReceived: z.instanceof(Money),
  /** The description of the transaction. */
  description: z.string().optional(),
  /** The fee charged by the mint to deposit money into the account. */
  mintingFee: z.instanceof(Money).optional(),
  /**
   * Amounts for each blinded message created for this receive.
   * Will be set only when the receive quote gets paid.
   */
  outputAmounts: z.array(z.number()).optional(),
  /**
   * The data of the cashu token melted for the receive.
   * This will be set only for cashu token receives when the destination account is not the mint that issued the token (the token was melted to pay the lightning invoice of the mint quote from the destination mint).
   */
  cashuTokenData: CashuTokenDataSchema.optional(),
  /**
   * The total fees for the transaction.
   * Sum of the mintingFee, cashuReceiveFee and lightningFeeReserve.
   */
  totalFees: z.instanceof(Money),
});

export type CashuLightningReceiveData = z.infer<
  typeof CashuLightningReceiveDataSchema
>;
