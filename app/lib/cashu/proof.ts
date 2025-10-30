import type { Proof } from '@cashu/cashu-ts';
import { hashToCurve } from '@cashu/crypto/modules/common';
import type { CashuProof } from '~/features/accounts/account';
import { parseSecret } from './secret';

/** Sum the amounts from a list of proofs. */
export const sumProofs = (proofs: (Proof | CashuProof)[]): number => {
  return proofs.reduce((acc, proof) => {
    return acc + proof.amount;
  }, 0);
};

/**
 * Determinsitcally maps the proof's secret to point on the curve.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/00.md#hash_to_curvex-bytes---curve-point-y
 */
export const proofToY = (proof: Proof): string => {
  const encoder = new TextEncoder();
  return hashToCurve(encoder.encode(proof.secret)).toHex(true);
};

type GetClaimableProofsResult =
  | {
      claimableProofs: Proof[];
      cannotClaimReason: null;
    }
  | {
      claimableProofs: null;
      cannotClaimReason: string;
    };

/**
 * Checks the proofs spending conditions against the given pubkeys.
 * @param proofs - The list of proofs to check.
 * @param pubkeys - The pubkeys that a valid signature can be created for.
 * @returns The proofs claimable by the given pubkeys or a reason why the proofs are not claimable.
 */
export const getClaimableProofs = (
  proofs: Proof[],
  pubkeys: string[],
): GetClaimableProofsResult => {
  // First, filter the proofs to find claimable ones and collect reasons
  const claimabilityResults = proofs.map((proof) =>
    isProofClaimable(proof, pubkeys),
  );
  const claimableProofs = proofs.filter(
    (_, index) => claimabilityResults[index].claimable,
  );

  // If no proofs are claimable, return the first valid reason
  if (claimableProofs.length === 0) {
    const firstReason = claimabilityResults.find(
      (result) => result.reason,
    )?.reason;

    return {
      claimableProofs: null,
      cannotClaimReason:
        firstReason ?? 'You do not have permission to claim this ecash',
    };
  }

  // Otherwise return the claimable proofs
  return { claimableProofs, cannotClaimReason: null };
};

const isProofClaimable = (proof: Proof, pubkeys: string[]) => {
  const parsedSecret = parseSecret(proof.secret);
  if (!parsedSecret.success) {
    return {
      claimable: false,
      reason: 'This ecash contains invalid spending conditions.',
    };
  }

  const secret = parsedSecret.data;

  if (secret.type === 'plain') {
    return { claimable: true, reason: null };
  }
  if (secret.type === 'nut10' && secret.secret.kind === 'P2PK') {
    return {
      claimable: pubkeys.includes(secret.secret.data),
      reason: pubkeys.includes(secret.secret.data)
        ? null
        : 'You do not have permission to claim this ecash',
    };
  }

  return {
    claimable: false,
    reason: 'This ecash contains an unknown spending condition.',
  };
};
