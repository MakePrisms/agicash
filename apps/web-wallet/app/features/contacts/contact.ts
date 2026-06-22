import type { Contact } from '@agicash/wallet-sdk';
import { z } from 'zod/mini';

export type { Contact };

/** The runtime shape of a contact — `createdAt` is a `Date`. */
const ContactSchema = z.object({
  id: z.string(),
  createdAt: z.instanceof(Date),
  ownerId: z.string(),
  username: z.string(),
  lud16: z.string(),
});

/**
 * Type guard over the runtime contact shape, used to distinguish a Contact from
 * a plain string in send-flow resolution.
 */
export const isContact = (value: unknown): value is Contact => {
  return ContactSchema.safeParse(value).success;
};
