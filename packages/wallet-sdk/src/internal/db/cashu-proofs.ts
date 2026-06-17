import { z } from 'zod/mini';
import type { Proof } from '@cashu/cashu-ts';
import type { Encryption } from '../crypto/encryption';
import { ProofSchema, proofToY } from '../lib/cashu';
import type { AgicashDbCashuProof } from './database';
import type { CashuProof } from '../../types/account';

/**
 * Decrypt + map DB proof rows (whose `amount`/`secret` are encrypted) to domain
 * {@link CashuProof}s. The encrypted values were stored flattened as
 * `[amount0, secret0, amount1, secret1, …]`; `decrypted` is the matching decrypted
 * array (already batch-decrypted alongside the entity's `encrypted_data`).
 */
export function toDecryptedCashuProofs(
  dbProofs: AgicashDbCashuProof[],
  decrypted: unknown[],
): CashuProof[] {
  return dbProofs.map((dbProof, index) => {
    const i = index * 2;
    return {
      id: dbProof.id,
      accountId: dbProof.account_id,
      userId: dbProof.user_id,
      keysetId: dbProof.keyset_id,
      amount: z.number().parse(decrypted[i]),
      secret: z.string().parse(decrypted[i + 1]),
      unblindedSignature: dbProof.unblinded_signature,
      publicKeyY: dbProof.public_key_y,
      dleq: ProofSchema.shape.dleq.parse(dbProof.dleq),
      witness: ProofSchema.shape.witness.parse(dbProof.witness),
      state: dbProof.state,
      version: dbProof.version,
      createdAt: dbProof.created_at,
      reservedAt: dbProof.reserved_at,
    };
  });
}

/** A DB-ready encrypted proof row (the non-encrypted columns + the encrypted amount/secret). */
export type EncryptedProofData = {
  keysetId: string;
  amount: string;
  secret: string;
  unblindedSignature: string;
  publicKeyY: string;
  dleq: Proof['dleq'] | null;
  witness: Proof['witness'] | null;
};

/**
 * Encrypt cashu-ts proofs for storage: batch-encrypts `[amount, secret]` pairs and
 * pairs them with the plaintext columns (keysetId/C/Y/dleq/witness). Used by the
 * `complete`/`commitProofsToSend`/`completeReceiveSwap` RPC inputs.
 */
export async function toEncryptedProofData(
  proofs: Proof[],
  encryption: Encryption,
): Promise<EncryptedProofData[]> {
  const flat = proofs.flatMap((x) => [x.amount, x.secret]);
  // `flatMap` yields a mutable array; `encryptBatch` wants `readonly unknown[]`.
  const encrypted = await encryption.encryptBatch(flat as readonly unknown[]);
  return proofs.map((x, index) => ({
    keysetId: x.id,
    amount: encrypted[index * 2] as string,
    secret: encrypted[index * 2 + 1] as string,
    unblindedSignature: x.C,
    publicKeyY: proofToY(x),
    dleq: x.dleq ?? null,
    witness: x.witness ?? null,
  }));
}
