import { z } from 'zod';

const ContactSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** Id of the user that this contact belongs to */
  ownerId: z.string(),
  /** Username of the user within this app that this contact references */
  username: z.string(),
  /** Lightning Address of the user that this contact references */
  lud16: z.string(),
});

export type Contact = z.infer<typeof ContactSchema>;

/**
 * Type guard to check if a value is a valid Contact
 * @param value - The value to check
 * @returns True if the value is a valid Contact, false otherwise
 */
export const isContact = (value: unknown): value is Contact => {
  return ContactSchema.safeParse(value).success;
};
