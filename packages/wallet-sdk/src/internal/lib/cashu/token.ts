import { type Currency, type CurrencyUnit, Money } from '@agicash/money';
import {
  CheckStateEnum,
  type Proof,
  type Token,
  type TokenMetadata,
  Wallet,
  getEncodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import { sha256Hex } from '../../crypto/sha256';
import { proofToY, sumProofs } from './proof';

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

/**
 * Encode a token without mutating the input.
 *
 * cashu-ts's getEncodedToken() mutates proof.id in place, truncating v2 keyset
 * IDs to their short form. This wrapper deep-clones proofs before encoding.
 *
 * TODO: remove after upgrading to cashu-ts v4 (fixed in cashu-ts#536)
 */
export function encodeToken(
  ...[token, opts]: Parameters<typeof getEncodedToken>
): ReturnType<typeof getEncodedToken> {
  return getEncodedToken(
    { ...token, proofs: token.proofs.map((p) => ({ ...p })) },
    opts,
  );
}

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

function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
} {
  if (token.unit === 'sat') return { currency: 'BTC', unit: 'sat' };
  if (token.unit === 'usd') return { currency: 'USD', unit: 'cent' };
  throw new Error(`Invalid token unit ${token.unit}`);
}

/** The total value of a cashu token as {@link Money}, in the token's currency. */
export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  return new Money<Currency>({
    amount: sumProofs(token.proofs),
    currency,
    unit,
  });
}

/** SHA-256 hash of an encoded token (or token object), used as the swap identity. */
export function getTokenHash(token: Token | string): Promise<string> {
  return typeof token === 'string'
    ? sha256Hex(token)
    : sha256Hex(encodeToken(token));
}
