import { safeJsonParse } from '../json';
import { type ProofSecret, RawNUT10SecretSchema } from './types';

const isValidHexString = (str: string): boolean => {
  return /^[0-9a-fA-F]+$/.test(str);
};

type ParseSecretResult =
  | { success: true; data: ProofSecret }
  | { success: false; error: string };

/**
 * Parse secret string from Proof.secret into a well-known secret [NUT-10](https://github.com/cashubtc/nuts/blob/main/10.md)
 * or a string [NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md)
 * @param secret - The stringified secret to parse
 * @returns An object with success flag and either the parsed secret or an error message
 */
export const parseSecret = (secret: string): ParseSecretResult => {
  const parsed = safeJsonParse(secret);
  if (!parsed.success) {
    // if parsing fails, check if it's a valid hex string
    // as defined in NUT-00
    if (isValidHexString(secret)) {
      return { success: true, data: { type: 'plain', secret } };
    }
    return { success: false, error: 'Invalid secret' };
  }

  // if not a plain string, then validate the parsed JSON is a valid NUT-10 secret
  const validatedSecret = RawNUT10SecretSchema.safeParse(parsed.data);
  if (!validatedSecret.success) {
    return { success: false, error: 'Invalid secret format' };
  }

  const [kind, { nonce, data, tags }] = validatedSecret.data;
  return {
    success: true,
    data: { type: 'nut10', secret: { kind, nonce, data, tags } },
  };
};
