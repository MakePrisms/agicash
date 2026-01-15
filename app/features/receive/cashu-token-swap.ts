import { z } from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Base schema for a cashu token swap.
 *
 * A token swap is the process of receiving a Cashu token into
 * the user's account that matches the mint of the token by using
 * the `/v1/swap` endpoint of the mint as defined in [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md).
 *
 * A swap is created in the database when a user inputs a token and chooses
 * the matching receive account.
 *
 * All PENDING swaps are tracked upon insert and completed in the background.
 */
const CashuTokenSwapBaseSchema = z.object({
  /** Hash of the token being received used to identify the swap */
  tokenHash: z.string(),
  /** Proofs from the token being received */
  tokenProofs: z.array(ProofSchema),
  /** ID of the user receiving the token */
  userId: z.string(),
  /** ID of the account receiving the token */
  accountId: z.string(),
  /**
   * Amount of the token being received in the corresponding currency.
   * Will differ from actual amount received if mint charges fees.
   */
  inputAmount: z.instanceof(Money),
  /** Amount that will actually be received after the mint's fees are deducted */
  receiveAmount: z.instanceof(Money),
  /** Fee that is deducted from the input amount */
  feeAmount: z.instanceof(Money),
  /** ID of the keyset used for blinded messages */
  keysetId: z.string(),
  /** Starting counter value used to generate the blinded messages */
  keysetCounter: z.number(),
  /**
   * Amounts for each blinded message.
   * The sum of these values is what will actually be received after fees are deducted.
   */
  outputAmounts: z.array(z.number()),
  /** ID of the corresponding transaction */
  transactionId: z.string(),
  /** Version of the token swap as seen by the client. Used for optimistic concurrency control. */
  version: z.number(),
  /** Timestamp when the token swap was created */
  createdAt: z.string(),
});

const CashuTokenSwapPendingStateSchema = z.object({
  /** The swap was created, but we still need to swap with the mint and store the proofs */
  state: z.literal('PENDING'),
});

const CashuTokenSwapCompletedStateSchema = z.object({
  /** The swap is completed, and the proofs have been stored */
  state: z.literal('COMPLETED'),
});

const CashuTokenSwapFailedStateSchema = z.object({
  /** The swap failed */
  state: z.literal('FAILED'),
  /** Reason for the failure */
  failureReason: z.string(),
});

/**
 * Schema for cashu token swap.
 */
export const CashuTokenSwapSchema = z.intersection(
  CashuTokenSwapBaseSchema,
  z.union([
    CashuTokenSwapPendingStateSchema,
    CashuTokenSwapCompletedStateSchema,
    CashuTokenSwapFailedStateSchema,
  ]),
);

export type CashuTokenSwap = z.infer<typeof CashuTokenSwapSchema>;
