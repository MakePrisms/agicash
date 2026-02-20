import { z } from 'zod';
import { Money } from '../../lib/money';
import { CashuProofSchema } from '../accounts/cashu-account';

/**
 * Schema for Agicash contact destination.
 */
const AgicashContactDestinationSchema = z.object({
  sendType: z.literal('AGICASH_CONTACT'),
  /**
   * The ID of the Agicash contact receiving the payment.
   */
  contactId: z.string(),
});

/**
 * Schema for Lightning address destination.
 */
const LnAddressDestinationSchema = z.object({
  sendType: z.literal('LN_ADDRESS'),
  /**
   * The lightning address that the invoice was fetched from.
   */
  lnAddress: z.string(),
});

/**
 * Schema for additional details related to the transaction destination.
 */
export const DestinationDetailsSchema = z.discriminatedUnion('sendType', [
  AgicashContactDestinationSchema,
  LnAddressDestinationSchema,
]);

export type DestinationDetails = z.infer<typeof DestinationDetailsSchema>;

/**
 * Base schema for cashu send quote.
 */
const CashuSendQuoteBaseSchema = z.object({
  /**
   * UUID of the quote.
   */
  id: z.string(),
  /**
   * Date and time the send was created in ISO 8601 format.
   */
  createdAt: z.string(),
  /**
   * Date and time the send quote expires in ISO 8601 format.
   */
  expiresAt: z.string(),
  /**
   * UUID of the user that the quote belongs to.
   */
  userId: z.string(),
  /**
   * UUID of the Agicash account to send from.
   */
  accountId: z.string(),
  /**
   * Bolt 11 payment request that is a destination of the send.
   */
  paymentRequest: z.string(),
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: z.string(),
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
   * Currency will be the same as the currency of the account we are sending from.
   * If payment ends up being cheaper than the fee reserve, the difference will be returned as change.
   */
  lightningFeeReserve: z.instanceof(Money),
  /**
   * Cashu mint fee for the proofs used.
   * Currency will be the same as the currency of the account we are sending from.
   */
  cashuFee: z.instanceof(Money),
  /**
   * ID of the melt quote.
   */
  quoteId: z.string(),
  /**
   * Cashu proofs to melt.
   * Amounts are denominated in the cashu units (e.g. sats for BTC accounts, cents for USD accounts).
   * Sum of the proof amounts is equal or greater than the amount to send plus the fee reserve. Any overflow will be returned as change.
   */
  proofs: z.array(CashuProofSchema),
  /**
   * The amount reserved for the send.
   * This is the sum of all proofs used as inputs to the cashu melt operation.
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
   * ID of the keyset used for the send.
   */
  keysetId: z.string(),
  /**
   * Counter value for the keyset at the time the time of send.
   */
  keysetCounter: z.number(),
  /**
   * Number of ouputs that will be used for the send change.
   */
  numberOfChangeOutputs: z.number(),
  /**
   * UUID of the corresponding transaction.
   */
  transactionId: z.string(),
  /**
   * Version of the send quote.
   * Can be used for optimistic locking.
   */
  version: z.number(),
});

const CashuSendQuoteUnpaidStateSchema = z.object({
  state: z.literal('UNPAID'),
});

const CashuSendQuotePendingStateSchema = z.object({
  state: z.literal('PENDING'),
});

const CashuSendQuoteExpiredStateSchema = z.object({
  state: z.literal('EXPIRED'),
});

const CashuSendQuoteFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  /**
   * Reason for the failure of the send quote.
   */
  failureReason: z.string(),
});

const CashuSendQuotePaidStateSchema = z.object({
  state: z.literal('PAID'),
  /**
   * Lightning payment preimage.
   */
  paymentPreimage: z.string(),
  /**
   * Actual Lightning Network fee that was charged.
   * Currency will be the same as the currency of the account we are sending from.
   * This will be undefined until the send is completed.
   */
  lightningFee: z.instanceof(Money),
  /**
   * Total amount spent on the lightning payment.
   * This is the amount to send plus the actual fee paid to the lightning network.
   * Currency will be the same as the currency of the account we are sending from.
   */
  amountSpent: z.instanceof(Money),
  /**
   * The total fee for the transaction.
   * This is the sum of `lightningFee` and `cashuFee`.
   */
  totalFee: z.instanceof(Money),
});

/**
 * Schema for cashu send quote.
 */
export const CashuSendQuoteSchema = z.intersection(
  CashuSendQuoteBaseSchema,
  z.union([
    CashuSendQuoteUnpaidStateSchema,
    CashuSendQuotePendingStateSchema,
    CashuSendQuoteExpiredStateSchema,
    CashuSendQuoteFailedStateSchema,
    CashuSendQuotePaidStateSchema,
  ]),
);

export type CashuSendQuote = z.infer<typeof CashuSendQuoteSchema>;
