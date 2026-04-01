import { z } from 'zod';

export const OfferCardConfigSchema = z.array(
  z.object({
    url: z.url(),
    name: z.string().min(1),
    currency: z.enum(['USD', 'BTC']),
  }),
);

export const JsonOfferCardConfigSchema = z
  .string()
  .transform((str) => JSON.parse(str))
  .pipe(OfferCardConfigSchema);

export type OfferCardConfig = z.infer<typeof OfferCardConfigSchema>[number];
