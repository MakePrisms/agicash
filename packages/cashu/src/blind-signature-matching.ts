import {
  type HasKeysetKeys,
  type OutputData,
  type Proof,
  type SerializedBlindedSignature,
  pointFromHex,
  verifyDLEQProof_reblind,
} from '@cashu/cashu-ts';
import { hexToBytes } from '@noble/hashes/utils';

/**
 * Match blind signatures to output data using DLEQ verification.
 *
 * Mints may return blind signatures in non-deterministic order (e.g., when
 * fetched from a database without ORDER BY). This function matches each
 * signature to its corresponding OutputData by trial-unblinding and verifying
 * the DLEQ proof, rather than relying on positional pairing.
 *
 * Requires NUT-12 (DLEQ proofs) on all signatures.
 *
 * @throws If any signature is missing a DLEQ proof or cannot be matched.
 */
export function matchBlindSignaturesToOutputData(
  signatures: SerializedBlindedSignature[],
  outputData: OutputData[],
  keyset: HasKeysetKeys,
): Proof[] {
  const unmatched = new Set(outputData.map((_, i) => i));
  const result: Proof[] = [];
  const matchedIndices: number[] = [];

  for (let sigIdx = 0; sigIdx < signatures.length; sigIdx++) {
    const sig = signatures[sigIdx];
    if (!sig.dleq) {
      throw new Error(
        'Cannot match blind signatures without DLEQ proofs (NUT-12)',
      );
    }

    let matched = false;

    for (const i of unmatched) {
      const od = outputData[i];
      const proof = od.toProof(sig, keyset);

      if (!proof.dleq) {
        continue;
      }

      const K = pointFromHex(keyset.keys[sig.amount]);
      const C = pointFromHex(proof.C);

      const isValid = verifyDLEQProof_reblind(
        new TextEncoder().encode(proof.secret),
        {
          s: hexToBytes(proof.dleq.s),
          e: hexToBytes(proof.dleq.e),
          r: od.blindingFactor,
        },
        C,
        K,
      );

      if (isValid) {
        result.push(proof);
        matchedIndices.push(i);
        unmatched.delete(i);
        matched = true;
        break;
      }
    }

    if (!matched) {
      throw new Error(
        `No matching OutputData found for blind signature (amount=${sig.amount})`,
      );
    }
  }

  // Detect if positional pairing would have been wrong
  const wasReordered = matchedIndices.some((odIdx, sigIdx) => odIdx !== sigIdx);
  if (wasReordered) {
    console.warn(
      'Blind signatures were out of order — DLEQ matching corrected the pairing.',
    );
  }

  return result;
}
