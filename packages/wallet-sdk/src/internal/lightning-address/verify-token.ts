import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '@agicash/ecies';
import { base64url } from '@scure/base';
import { z } from 'zod/mini';

/**
 * Payload encoded into the LUD-21 `verify` URL segment. Encrypted with the
 * server's symmetric key (not a user key) to obfuscate the quote id from the
 * LNURL client. For cashu, `quoteId` is the mint quote id; for spark it is the
 * Spark receive-request id.
 */
export const LnurlVerifyQuoteDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spark'), quoteId: z.string() }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
  }),
]);

export type LnurlVerifyQuoteData = z.infer<typeof LnurlVerifyQuoteDataSchema>;

export function encodeVerifyToken(
  payload: LnurlVerifyQuoteData,
  key: Uint8Array,
): string {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = encryptXChaCha20Poly1305(data, key);
  return base64url.encode(encrypted);
}

export function decodeVerifyToken(
  token: string,
  key: Uint8Array,
): LnurlVerifyQuoteData {
  const encrypted = base64url.decode(token);
  const decrypted = decryptXChaCha20Poly1305(encrypted, key);
  return LnurlVerifyQuoteDataSchema.parse(
    JSON.parse(new TextDecoder().decode(decrypted)),
  );
}
