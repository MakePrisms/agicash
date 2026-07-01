import { z } from 'zod/mini';

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
