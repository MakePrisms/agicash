import {
  CashuMint,
  CashuWallet,
  CheckStateEnum,
  type Proof,
  type Token,
  getDecodedToken,
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
  const wallet = new CashuWallet(new CashuMint(token.mint), {
    unit: token.unit,
  });
  const states = await wallet.checkProofsStates(token.proofs);

  return token.proofs.filter((proof) => {
    const Y = proofToY(proof);
    const state = states.find((s) => s.Y === Y);
    return state?.state === CheckStateEnum.UNSPENT;
  });
};

const getDecodedTokenSafe = (
  encodedToken: string,
):
  | {
      success: true;
      token: Token;
    }
  | {
      success: false;
      error: string;
    } => {
  try {
    return { success: true, token: getDecodedToken(encodedToken) };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to decode token';
    return { success: false, error: errorMessage };
  }
};

/**
 * Extract a cashu token from a string if there is one and then validate it
 * @param content - The content to extract the encoded cashu token from (a string like a URL or a direct token)
 * @returns The extracted token if found and valid, otherwise null
 */
export const extractCashuToken = (content: string): Token | null => {
  // Look for V3 (cashuA) or V4 (cashuB) tokens anywhere in the content
  // Tokens are base64_urlsafe encoded, so they can contain: A-Z, a-z, 0-9, -, _, and optional = padding
  // See https://github.com/cashubtc/nuts/blob/main/00.md#serialization-of-tokens for more details
  const tokenMatch = content.match(/cashu[AB][A-Za-z0-9_-]+={0,2}/);
  if (tokenMatch) {
    const extractedToken = tokenMatch[0];
    const result = getDecodedTokenSafe(extractedToken);
    if (result.success) {
      return result.token;
    }
  }

  return null;
};
