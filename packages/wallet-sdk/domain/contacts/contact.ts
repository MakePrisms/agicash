import { z } from 'zod/mini';

const ContactSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** Username of the user within this app that this contact references */
  username: z.string(),
  /** Lightning Address of the user that this contact references */
  lud16: z.string(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const isContact = (value: unknown): value is Contact => {
  return ContactSchema.safeParse(value).success;
};
