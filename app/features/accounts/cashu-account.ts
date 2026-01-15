import type { Proof } from '@cashu/cashu-ts';
import { z } from 'zod';
import { SerializedDLEQSchema, WitnessSchema } from '~/lib/cashu/types';

export const CashuProofSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  userId: z.string(),
  keysetId: z.string(),
  amount: z.number(),
  secret: z.string(),
  unblindedSignature: z.string(),
  publicKeyY: z.string(),
  dleq: SerializedDLEQSchema.optional(),
  witness: WitnessSchema.optional(),
  state: z.enum(['UNSPENT', 'RESERVED', 'SPENT']),
  version: z.number(),
  createdAt: z.string(),
  reservedAt: z.string().nullable().optional(),
  spentAt: z.string().nullable().optional(),
});

export type CashuProof = z.infer<typeof CashuProofSchema>;

export const toProof = (proof: CashuProof): Proof => {
  return {
    id: proof.keysetId,
    amount: proof.amount,
    secret: proof.secret,
    C: proof.unblindedSignature,
    dleq: proof.dleq,
    witness: proof.witness,
  };
};
