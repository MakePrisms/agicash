import { z } from 'zod';
import { DestinationDetailsSchema } from '~/features/send/cashu-send-quote';
import { Money } from '~/lib/money';

/**
 * Schema for cashu lightning send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const CashuLightningSendDbDataSchema = z.object({
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: z.string(),
  /**
   * Amount requested to send.
   * For payment requests that have the amount defined, the amount will match what is defined in the request and will always be in BTC currency.
   * For amountless payment requests, the amount will be the amount defined by the sender (what gets sent to mint in this case is this amount converted to BTC using our exchange rate at the time of quote creation).
   */
  amountRequested: z.instanceof(Money),
  /**
   * Amount requested to send converted to milli-satoshis.
   * For amountless payment requests, this is the amount that gets sent to the mint when creating a melt quote.
   * It will be the amount requested converted to milli-satoshis using our exchange rate at the time of quote creation.
   */
  amountRequestedInMsat: z.number(),
  /**
   * Amount that the receiver receives.
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do the conversion using their exchange rate at the time of quote creation.
   */
  amountReceived: z.instanceof(Money),
  /**
   * Fee reserve for the lightning network fee.
   */
  lightningFeeReserve: z.instanceof(Money),
  /**
   * Cashu mint fee for the proofs used for the send.
   */
  cashuSendFee: z.instanceof(Money),
  /**
   * ID of the melt quote.
   */
  meltQuoteId: z.string(),
  /**
   * The amount reserved for the send.
   * This is the sum of all proofs used as inputs to the cashu melt operation. This can be greater than the estimated total cost of the send when there is no exact
   * denomination of the proofs to cover the estimated send cost. These proofs are reserved until the send is completed or failed.
   * When the send is completed, the change is returned to the account.
   */
  amountReserved: z.instanceof(Money),
  /**
   * Destination details of the send.
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails: DestinationDetailsSchema.optional(),
  /**
   * Preimage of the lightning payment.
   * Will be set only when the send is completed.
   * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'.
   */
  paymentPreimage: z.string().optional(),
  /**
   * Amount spent on the send.
   * This is the sum of `amountReceived` and `totalFee`.
   * Available only when the send is completed.
   */
  amountSpent: z.instanceof(Money).optional(),
  /**
   * The actual Lightning Network fee that was charged after the transaction completed.
   * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
   * The difference between `lightningFeeReserve` and `lightningFee`, along with any overpaid inputs, is returned as change to the user.
   * Available only when the send is completed.
   */
  lightningFee: z.instanceof(Money).optional(),
  /**
   * The actual fee for the transaction.
   * This is the sum of `lightningFee` and `cashuSendFee`.
   * Available only when the send is completed.
   */
  totalFee: z.instanceof(Money).optional(),
});

/**
 * Cashu lightning send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export type CashuLightningSendDbData = z.infer<
  typeof CashuLightningSendDbDataSchema
>;
