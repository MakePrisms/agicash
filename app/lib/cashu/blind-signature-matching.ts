import type {
  HasKeysetKeys,
  OutputData,
  Proof,
  SerializedBlindedSignature,
} from '@cashu/cashu-ts';

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

      let proof: Proof;
      try {
        proof = od.toProof(sig, keyset);
      } catch {
        // OutputData.toProof verifies DLEQ internally and throws on mismatch;
        // treat that as a non-match and continue trying other OutputData.
        continue;
      }

      result.push(proof);
      matchedIndices.push(i);
      unmatched.delete(i);
      matched = true;
      break;
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
