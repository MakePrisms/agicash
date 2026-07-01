import { GiftCardConfigSchema } from '@agicash/wallet-sdk';
import { z } from 'zod/mini';

/**
 * Parses the `VITE_GIFT_CARDS` env var, a JSON string, into validated gift card
 * configs. Lives in the web app rather than the SDK because sourcing gift card
 * configs from an env var is a web deployment concern, not wallet domain logic.
 */
export const JsonGiftCardConfigSchema = z.pipe(
  z.pipe(
    z.string(),
    z.transform((str) => JSON.parse(str)),
  ),
  GiftCardConfigSchema,
);
