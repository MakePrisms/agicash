import { z } from 'zod/mini';

export const GiftCardConfigSchema = z.array(
  z.object({
    url: z.url(),
    name: z.string().check(z.minLength(1)),
    currency: z.enum(['USD', 'BTC']),
    purpose: z.enum(['gift-card', 'offer']),
    isDiscoverable: z.boolean(),
    addCardDisclaimer: z.optional(z.string()),
    validPaymentDestinations: z.optional(
      z.object({
        descriptions: z.array(z.string()),
        nodePubkeys: z.array(z.string().check(z.toLowerCase())),
      }),
    ),
  }),
);

export const JsonGiftCardConfigSchema = z.pipe(
  z.pipe(
    z.string(),
    z.transform((str) => JSON.parse(str)),
  ),
  GiftCardConfigSchema,
);

export type GiftCardConfig = z.infer<typeof GiftCardConfigSchema>[number];

export type GiftCardInfo = GiftCardConfig & {
  image: string;
  ogImage: string | undefined;
};
