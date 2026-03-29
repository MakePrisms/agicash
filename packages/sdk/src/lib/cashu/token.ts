import {
  CheckStateEnum,
  type Proof,
  type Token,
  type TokenMetadata,
  Wallet,
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

const CASHU_TOKEN_REGEX = /cashu[AB][A-Za-z0-9_-]+={0,2}/;

/**
 * Find and validate a cashu token in arbitrary content without fully decoding it.
 * Uses regex to find the token, then getTokenMetadata() to validate structure.
 * @param content - The content to search for a cashu token (URL, clipboard text, etc.)
 * @returns The encoded token string and metadata, or null if not found/invalid.
 */
export function extractCashuToken(
  content: string,
): { encoded: string; metadata: TokenMetadata } | null {
  const tokenMatch = content.match(CASHU_TOKEN_REGEX);
  if (!tokenMatch) return null;

  try {
    const metadata = getTokenMetadata(tokenMatch[0]);
    return { encoded: tokenMatch[0], metadata };
  } catch {
    return null;
  }
}
