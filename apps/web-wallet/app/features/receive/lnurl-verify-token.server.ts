import type { LnurlVerifyRef } from '@agicash/wallet-sdk';
import { hexToBytes } from '@noble/hashes/utils';
import { base64url } from '@scure/base';
import { z } from 'zod/mini';
import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '~/lib/xchacha20poly1305';

/**
 * The quote reference encrypted into the LUD-21 `verify` URL. Mirrors the SDK's
 * `LnurlVerifyRef`; kept route-side because the token is wire-transport
 * obfuscation, not SDK surface (S10 D10-3). `decode`'s return-type annotation
 * pins the schema to `LnurlVerifyRef` so tsc fails if the union ever drifts.
 */
const LnurlVerifyRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spark'), quoteId: z.string() }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
  }),
]);

export type LnurlVerifyTokenCodec = {
  encode(ref: LnurlVerifyRef): string;
  decode(token: string): LnurlVerifyRef;
};

/**
 * Build an xChaCha20-Poly1305 codec for the LNURL verify token (encrypt to
 * obfuscate the quote from the LNURL client, base64url for the URL path).
 * @param keyHex hex-encoded 32-byte symmetric key
 */
export function createLnurlVerifyTokenCodec(
  keyHex: string,
): LnurlVerifyTokenCodec {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'LNURL_SERVER_ENCRYPTION_KEY must be 64 hex characters (a 32-byte key)',
    );
  }
  const key = hexToBytes(keyHex);
  return {
    encode(ref: LnurlVerifyRef): string {
      const data = new TextEncoder().encode(JSON.stringify(ref));
      return base64url.encode(encryptXChaCha20Poly1305(data, key));
    },
    decode(token: string): LnurlVerifyRef {
      const decrypted = decryptXChaCha20Poly1305(base64url.decode(token), key);
      return LnurlVerifyRefSchema.parse(
        JSON.parse(new TextDecoder().decode(decrypted)),
      );
    },
  };
}

let codec: LnurlVerifyTokenCodec | undefined;

/**
 * Process-singleton codec keyed by `LNURL_SERVER_ENCRYPTION_KEY`, read +
 * validated LAZILY on first call (never at import, so `bun test` stays hermetic
 * — tests use `createLnurlVerifyTokenCodec` directly).
 */
export function getLnurlVerifyTokenCodec(): LnurlVerifyTokenCodec {
  if (!codec) {
    const keyHex = process.env.LNURL_SERVER_ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
    }
    codec = createLnurlVerifyTokenCodec(keyHex);
  }
  return codec;
}
