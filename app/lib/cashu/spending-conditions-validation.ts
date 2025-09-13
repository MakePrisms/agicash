import type { Token } from '@cashu/cashu-ts';
import { getPublicKeyFromPrivateKey } from '../secp256k1';
import { parseSecret } from './secret';
import type { UnlockingData } from './types';

/**
 * Result of validating token spending conditions.
 * True if the token is spendable with the given unlocking data.
 * False if the token cannot be spent with the given unlocking data.
 */
export type SpendingConditionsValidationResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Parse timelock value from NUT-10 secret tags
 * @param tags - The tags array from a NUT-10 secret
 * @returns Unix timestamp if locktime tag is found, null otherwise
 */
const parseLocktimeFromTags = (tags?: string[][]): number | null => {
  if (!tags) return null;

  const locktimeTag = tags.find((tag) => tag[0] === 'locktime');
  if (!locktimeTag || locktimeTag.length < 2) return null;

  const timestamp = Number.parseInt(locktimeTag[1], 10);
  return Number.isNaN(timestamp) ? null : timestamp;
};

/**
 * Parse refund keys from NUT-10 secret tags
 * @param tags - The tags array from a NUT-10 secret
 * @returns Array of refund keys if refund tags are found, empty array otherwise
 */
const parseRefundKeysFromTags = (tags?: string[][]): string[] => {
  if (!tags) return [];

  return tags
    .filter((tag) => tag[0] === 'refund' && tag.length >= 2)
    .map((tag) => tag[1]);
};

/**
 * Check if a timelock has expired
 * @param locktime - Unix timestamp of the lock expiration
 * @returns True if the current time is past the locktime
 */
const isTimelockExpired = (locktime: number): boolean => {
  const currentTime = Math.floor(Date.now() / 1000);
  return currentTime > locktime;
};

/**
 * Validate P2PK spending conditions with unlocking data
 * @param requiredPubkey - The public key required by the spending condition
 * @param unlockingData - The unlocking data provided by the spender
 * @returns Validation result
 */
const validateP2PKCondition = (
  requiredPubkey: string,
  unlockingData?: UnlockingData,
): SpendingConditionsValidationResult => {
  if (!unlockingData) {
    return {
      success: false,
      error: 'P2PK spending condition requires unlocking data',
    };
  }

  if (unlockingData.kind !== 'P2PK') {
    return {
      success: false,
      error: `Expected P2PK unlocking data, got ${unlockingData.kind}`,
    };
  }

  if (!unlockingData.signingKeys?.length) {
    return {
      success: false,
      error: 'P2PK unlocking data must provide signing keys',
    };
  }

  const hasValidKey = unlockingData.signingKeys.some(() => {
    const pubkey = getPublicKeyFromPrivateKey(unlockingData.signingKeys[0], {
      asBytes: false,
    });
    return pubkey === requiredPubkey;
  });

  if (!hasValidKey) {
    return {
      success: false,
      error: 'Provided signing key does not match required public key',
    };
  }

  return { success: true };
};

/**
 * Validate spending conditions for a single proof's secret
 * @param secret - The proof's secret string
 * @param unlockingData - Optional unlocking data for conditional spending
 * @returns Validation result
 */
const validateProofSpendingConditions = (
  secret: string,
  unlockingData?: UnlockingData,
): SpendingConditionsValidationResult => {
  const parsedSecret = parseSecret(secret);
  if (!parsedSecret.success) {
    return {
      success: false,
      error: parsedSecret.error,
    };
  }

  // Plain secrets are always spendable
  if (parsedSecret.data.type === 'plain') {
    return { success: true };
  }

  const nut10Secret = parsedSecret.data.secret;

  // Handle P2PK conditions
  if (nut10Secret.kind === 'P2PK') {
    const locktime = parseLocktimeFromTags(nut10Secret.tags);
    const refundKeys = parseRefundKeysFromTags(nut10Secret.tags);

    // If there's a locktime and it has expired with no refund keys, it's spendable
    if (
      locktime !== null &&
      isTimelockExpired(locktime) &&
      refundKeys.length === 0
    ) {
      return { success: true };
    }

    // Otherwise, validate P2PK condition
    return validateP2PKCondition(nut10Secret.data, unlockingData);
  }

  return {
    success: false,
    error: `Spending condition '${nut10Secret.kind}' is not currently supported`,
  };
};

/**
 * Validate spending conditions for a Cashu token.
 *
 * Validates the following conditions:
 * - Plain secrets: Always valid
 * - P2PK with expired timelock and no refund keys: Valid
 * - P2PK with valid unlocking data: Valid if public key matches
 * - Other conditions: Invalid (not supported)
 *
 * @param token - The Cashu token to validate
 * @param unlockingData - Optional unlocking data for conditional spending
 * @returns Validation result indicating if token is spendable and why
 */
export const validateTokenSpendingConditions = (
  token: Token,
  unlockingData?: UnlockingData,
): SpendingConditionsValidationResult => {
  // Validate each proof in the token
  for (const proof of token.proofs) {
    const result = validateProofSpendingConditions(proof.secret, unlockingData);
    if (!result.success) {
      return result;
    }
  }

  return { success: true };
};
