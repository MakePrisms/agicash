import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuProofSchema } from '../accounts/cashu-account';

/**
 * Base schema for cashu send swap.
 *
 * A CashuSendSwap spends proofs from an account (or swaps them if the no exact
 * amount with available proofs) and encodes them into a token to share with the receiver.
 *
 * When in the DRAFT state, the proofs from the account that we will use for the
 * swap have been committed to in this entity. To move the swap to the PENDING state,
 * the inputProofs are swapped for proofsToSend.
 *
 * When PENDING, the proofsToSend exist and we are just waiting for them to be spent.
 * In this state, the transaction can be reversed by swapping the proofsToSend back
 * into the account.
 *
 * Once the proofsToSend are spent, the swap is COMPLETED.
 */
const CashuSendSwapBaseSchema = z.object({
  /**
   * The id of the swap
   */
  id: z.string(),
  /**
   * The id of the account that the swap belongs to
   */
  accountId: z.string(),
  /**
   * The id of the user that the swap belongs to
   */
  userId: z.string(),
  /**
   * The proofs from the account that will be spent.
   * These are removed from the account's balance.
   */
  inputProofs: z.array(CashuProofSchema),
  /**
   * The sum of the inputProofs
   */
  inputAmount: z.instanceof(Money),
  /**
   * The amount requested to send by the user.
   */
  amountRequested: z.instanceof(Money),
  /**
   * The requested amount to send plus the cashuReceiveFee.
   */
  amountToSend: z.instanceof(Money),
  /**
   * The swap fee that will be incurred when the receiver claims the token.
   */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The swap fee that will be incurred when swapping the inputProofs to get the amountToSend worth of proofs to send.
   */
  cashuSendFee: z.instanceof(Money),
  /**
   * The total amount spent. This is the sum of amountToSend and cashuSendFee.
   */
  totalAmount: z.instanceof(Money),
  /**
   * The version of the swap used for optimistic locking.
   */
  version: z.number(),
  /**
   * The id of the transaction that the swap belongs to.
   */
  transactionId: z.string(),
  /**
   * The date the swap was created.
   */
  createdAt: z.date(),
});

const CashuSendSwapDraftStateSchema = z.object({
  state: z.literal('DRAFT'),
  /**
   * The keyset id used to generate the output data at the time the swap was created.
   */
  keysetId: z.string(),
  /**
   * The keyset counter used to generate the output data at the time the swap was created.
   */
  keysetCounter: z.number(),
  /**
   * The output data used for deterministic outputs when we swap the inputProofs
   * for proofsToSend.
   */
  outputAmounts: z.object({
    /** The output amounts to use when constructing the send output data. */
    send: z.array(z.number()),
    /** The output amounts to use when constructing the change output data. */
    change: z.array(z.number()),
  }),
});

const CashuSendSwapPendingCompletedStateSchema = z.object({
  state: z.enum(['PENDING', 'COMPLETED']),
  /**
   * The hash of the token being sent
   */
  tokenHash: z.string(),
  /**
   * The proofs that will be sent. If we have the exact proofs to send,
   * then this will be the same as inputProofs and no cashu swap will occur.
   * If the inputProofs sum to more than the amount to send, then this
   * will be the result of swapping the inputProofs for the amount to send.
   */
  proofsToSend: z.array(CashuProofSchema),
});

const CashuSendSwapFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  failureReason: z.string(),
});

const CashuSendSwapReversedStateSchema = z.object({
  state: z.literal('REVERSED'),
});

/**
 * Schema for cashu send swap.
 */
export const CashuSendSwapSchema = z.intersection(
  CashuSendSwapBaseSchema,
  z.union([
    CashuSendSwapDraftStateSchema,
    CashuSendSwapPendingCompletedStateSchema,
    CashuSendSwapFailedStateSchema,
    CashuSendSwapReversedStateSchema,
  ]),
);

export type CashuSendSwap = z.infer<typeof CashuSendSwapSchema>;

export type PendingCashuSendSwap = CashuSendSwap & { state: 'PENDING' };
