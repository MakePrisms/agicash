import { z } from 'zod';

export const GiftCardConfigSchema = z.array(
  z.object({
    url: z.string(),
    name: z.string().min(1),
    currency: z.enum(['USD', 'BTC']),
    addCardDisclaimer: z.string().optional(),
  }),
);

export const JsonGiftCardConfigSchema = z
  .string()
  .transform((str) => JSON.parse(str))
  .pipe(GiftCardConfigSchema);

export type GiftCardConfig = z.infer<typeof GiftCardConfigSchema>[number];
