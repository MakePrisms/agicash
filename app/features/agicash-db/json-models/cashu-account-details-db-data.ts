import { z } from 'zod';

export const CashuAccountDetailsDbDataSchema = z.object({
  /**
   * URL of the mint.
   */
  mint_url: z.string(),
  /**
   * Whether the mint is a test mint.
   */
  is_test_mint: z.boolean(),
  /**
   * Holds counter value for each mint keyset. Key is the keyset id, value is counter value.
   */
  keyset_counters: z.record(z.string(), z.number()),
  /**
   * Unix timestamp when the account's ecash expires (for offer accounts).
   * Derived from the active keyset's `final_expiry` field.
   * Null for non-offer accounts or when the keyset has no expiry.
   */
  expires_at: z.number().nullable().optional(),
});

export type CashuAccountDetailsDbData = z.infer<
  typeof CashuAccountDetailsDbDataSchema
>;
