import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { ProofSchema } from '../lib/cashu';

/** The parsed `tokenReceiveData` carried by a CASHU_TOKEN cashu/spark receive quote. */
export const CashuTokenMeltDataSchema = z.object({
  sourceMintUrl: z.string(),
  tokenAmount: z.instanceof(Money),
  tokenProofs: z.array(ProofSchema),
  meltQuoteId: z.string(),
  meltInitiated: z.boolean(),
  cashuReceiveFee: z.instanceof(Money),
  lightningFeeReserve: z.instanceof(Money),
  lightningFee: z.optional(z.instanceof(Money)),
});

export type CashuTokenMeltData = z.infer<typeof CashuTokenMeltDataSchema>;
