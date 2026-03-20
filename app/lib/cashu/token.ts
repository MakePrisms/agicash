import {
  CheckStateEnum,
  type Proof,
  type Token,
  Wallet,
  getDecodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import { proofToY } from './proof';

/**
 * A token consists of a set of proofs, and each proof can be in one of three states:
 * spent, pending, or unspent. When claiming a token, all that we care about is the unspent proofs.
 * The rest of the proofs will not be claimable.
 *
 * This function returns the set of proofs that are unspent
 * @param token - The token to get the unspent proofs from
 * @returns The set of unspent proofs
 */
export const getUnspentProofsFromToken = async (
  token: Token,
): Promise<Proof[]> => {
  const wallet = new Wallet(token.mint, {
    unit: token.unit,
  });
  const states = await wallet.checkProofsStates(token.proofs);

  return token.proofs.filter((proof) => {
    const Y = proofToY(proof);
    const state = states.find((s) => s.Y === Y);
    return state?.state === CheckStateEnum.UNSPENT;
  });
};

const TOKEN_REGEX = /cashu[AB][A-Za-z0-9_-]+={0,2}/;

/**
 * Extract and validate a cashu token string from arbitrary content.
 * Uses regex to find the token, then getTokenMetadata() to validate it's structurally valid.
 * Returns the raw encoded string without full decoding (no keyset resolution).
 * @param content - The content to search for a cashu token (URL, clipboard text, etc.)
 * @returns The encoded token string if found and valid, otherwise null.
 */
export function extractCashuTokenString(content: string): string | null {
  const tokenMatch = content.match(TOKEN_REGEX);
  if (!tokenMatch) return null;

  try {
    getTokenMetadata(tokenMatch[0]);
    return tokenMatch[0];
  } catch {
    return null;
  }
}

/**
 * Extract and decode a cashu token from arbitrary content.
 * Tries standard decode first (v1), then fetches keyset IDs from the mint for v2 resolution.
 *
 * @param content - The content to extract the encoded cashu token from.
 * @param fetchKeysetIds - Async resolver: given a mint URL, fetches keyset IDs.
 * @returns The decoded token if found and valid, otherwise null.
 */
export async function extractCashuToken(
  content: string,
  fetchKeysetIds: (mintUrl: string) => Promise<string[]>,
): Promise<Token | null> {
  const tokenString = extractCashuTokenString(content);
  if (!tokenString) return null;

  // Try standard decode — succeeds for v1 keyset IDs
  try {
    return getDecodedToken(tokenString);
  } catch {
    // V2 keyset IDs require resolution — fall through
  }

  // V2 fallback: get mint URL from metadata, fetch keyset IDs, retry
  try {
    const { mint } = getTokenMetadata(tokenString);
    const keysetIds = await fetchKeysetIds(mint);
    if (!keysetIds.length) return null;
    return getDecodedToken(tokenString, keysetIds);
  } catch {
    return null;
  }
}
