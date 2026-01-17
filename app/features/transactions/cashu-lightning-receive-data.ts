import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuTokenDataSchema } from './cashu-token-data';

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
   * For lightning receives this will be equal to mintingFee or zero if there is no minting fee.
   * For cashu token receives over lightning, this will be the sum of the mintingFee (if it exists), cashuReceiveFee and lightningFeeReserve.
   * TODO: should we update this with actual ln fee when known?
   */
  totalFees: z.instanceof(Money),
});

export type CashuLightningReceiveData = z.infer<
  typeof CashuLightningReceiveDataSchema
>;
