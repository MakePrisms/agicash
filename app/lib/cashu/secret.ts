import {
  type Secret,
  type SecretKind,
  parseSecret as parseNut10Secret,
} from '@cashu/cashu-ts';
import { safeJsonParse } from '../json';

const isValidHexString = (str: string): boolean => {
  return /^[0-9a-fA-F]+$/.test(str);
};

/**
 * A proof secret can be either a random hex string (NUT-00 plain secret)
 * or a NUT-10 structured secret (tuple of [kind, { nonce, data, tags? }]).
 */
export type ProofSecret =
  | {
      type: 'plain';
      secret: string;
    }
  | {
      type: 'nut10';
      secret: { kind: SecretKind; nonce: string; data: string; tags?: string[][] };
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

  // Use v3's parseSecret for NUT-10 validation
  let nut10Secret: Secret;
  try {
    nut10Secret = parseNut10Secret(secret);
  } catch {
    return { success: false, error: 'Invalid secret format' };
  }

  const [kind, { nonce, data, tags }] = nut10Secret;
  return {
    success: true,
    data: { type: 'nut10', secret: { kind, nonce, data, tags } },
  };
};
