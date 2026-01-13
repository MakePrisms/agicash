import { z } from 'zod';
import { Money } from '~/lib/money';
import { DestinationDetailsSchema } from './transaction';

/**
 * Schema for cashu lightning send data.
 */
export const CashuLightningSendDataSchema = z.object({
  /** Bolt 11 payment request. */
  paymentRequest: z.string(),
  /** Amount requested to send. */
  amountRequested: z.instanceof(Money),
  /** Amount requested to send converted to milli-satoshis. */
  amountRequestedInMsat: z.number(),
  /** Amount that the receiver will receive. */
  amountToReceive: z.instanceof(Money),
  /** Fee reserve for the lightning network fee. */
  lightningFeeReserve: z.instanceof(Money),
  /** Cashu mint fee for the proofs used for the send. */
  cashuSendFee: z.instanceof(Money),
  /** ID of the melt quote. */
  meltQuoteId: z.string(),
  /**
   * The sum of all proofs used as inputs to the cashu melt operation.
   * These proofs are reserved until the send is completed or failed.
   * When the send is completed, the change is returned to the account.
   */
  amountReserved: z.instanceof(Money),
  /**
   * Destination details of the send.
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails: DestinationDetailsSchema.optional(),
  /**
   * Amount spent on the send.
   * This is the amount to send plus the actual fee paid to the lightning network.
   * Available only when the send is completed.
   */
  amountSpent: z.instanceof(Money).optional(),
  /**
   * Preimage of the lightning payment.
   * Will be set only when the send is completed.
   * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'.
   */
  paymentPreimage: z.string().optional(),
  /**
   * The actual Lightning Network fee that was charged after the transaction completed.
   * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
   * The difference between the `lightningFeeReserve` and the `lightningFee` is returned as change to the user.
   * Available only when the send is completed.
   */
  lightningFee: z.instanceof(Money).optional(),
  /**
   * The actual fees for the transaction.
   * Sum of lightningFee and cashuSendFee.
   * Available only when the send is completed.
   */
  totalFees: z.instanceof(Money).optional(),
});

export type CashuLightningSendData = z.infer<
  typeof CashuLightningSendDataSchema
>;
