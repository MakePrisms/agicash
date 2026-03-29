import { z } from 'zod';
import { Money } from '../../lib/money';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

/**
 * Schema for cashu lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const CashuLightningReceiveDbDataSchema = z.object({
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * ID of the mint quote for this receive.
   */
  mintQuoteId: z.string(),
  /**
   * The amount credited to the account.
   */
  amountReceived: z.instanceof(Money),
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
   * Amounts for each blinded message created for this receive.
   * Will be set only when the receive quote gets paid.
   */
  outputAmounts: z.array(z.number()).optional(),
  /**
   * The data of the cashu token melted for the receive.
   * This will be set only for cashu token receives when the destination account is not the mint that issued the token (the token was melted to
   * pay the lightning invoice of the mint quote from the destination mint).
   */
  cashuTokenMeltData: CashuTokenMeltDbDataSchema.optional(),
  /**
   * The total fee for the transaction.
   * For lightning receives this will equal to `mintingFee` or zero if the mint has no minting fee.
   * For cashu token receives over lightning, this will be the sum of the `mintingFee` (if it exists), `cashuReceiveFee` and `lightningFeeReserve`.
   *
   * We are currently not returning the change to the user for cashu token receives over lightning. If we ever do, the totalFee should be
   * updated to use lightningFee instead of lightningFeeReserve once actual fee is known.
   */
  totalFee: z.instanceof(Money),
});

/**
 * Cashu lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type CashuLightningReceiveDbData = z.infer<
  typeof CashuLightningReceiveDbDataSchema
>;
