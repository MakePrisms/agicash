import { z } from 'zod';
import { SerializedDLEQSchema, WitnessSchema } from '~/lib/cashu/types';
import type { CashuProof } from '../accounts/account';
import type { AgicashDbCashuProof } from '../agicash-db/database';

export function toDecryptedCashuProofs(
  proofs: AgicashDbCashuProof[],
  decryptedProofsData: unknown[],
): CashuProof[] {
  return proofs.map((dbProof, index) => {
    const decryptedDataIndex = index * 2;
    const amount = z.number().parse(decryptedProofsData[decryptedDataIndex]);
    const secret = z
      .string()
      .parse(decryptedProofsData[decryptedDataIndex + 1]);

    return {
      id: dbProof.id,
      accountId: dbProof.account_id,
      userId: dbProof.user_id,
      keysetId: dbProof.keyset_id,
      amount,
      secret,
      unblindedSignature: dbProof.unblinded_signature,
      publicKeyY: dbProof.public_key_y,
      dleq: SerializedDLEQSchema.parse(dbProof.dleq),
      witness: WitnessSchema.parse(dbProof.witness),
      state: dbProof.state,
      version: dbProof.version,
      createdAt: dbProof.created_at,
      reservedAt: dbProof.reserved_at,
    };
  });
}
