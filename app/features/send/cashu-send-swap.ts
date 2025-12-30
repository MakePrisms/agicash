import type { Money } from '~/lib/money';
import type { CashuProof } from '../accounts/account';

/**
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
export type CashuSendSwap = {
  /**
   * The id of the swap
   */
  id: string;
  /**
   * The id of the account that the swap belongs to
   */
  accountId: string;
  /**
   * The id of the user that the swap belongs to
   */
  userId: string;
  /**
   * The proofs from the account that will be spent.
   * These are removed from the account's balance.
   */
  inputProofs: CashuProof[];
  /**
   * The sum of the inputProofs
   */
  inputAmount: Money;
  /**
   * The amount requested to send by the user.
   */
  amountRequested: Money;
  /**
   * The requested amount to send plus the cashuReceiveFee.
   */
  amountToSend: Money;
  /**
   * The swap fee that will be incurred when the receiver claims the token.
   */
  cashuReceiveFee: Money;
  /**
   * The swap fee that will be incurred when swapping the inputProofs to get the amountToSend worth of proofs to send.
   */
  cashuSendFee: Money;
  /**
   * The total amount spent. This is the sum of amountToSend and cashuSendFee.
   */
  totalAmount: Money;
  /**
   * - DRAFT: The swap entity has been created, but there are no proofs to send yet. At this point,
   * we have only taken the inputProofs from the account
   * - PENDING: There are proofs to send and the swap is waiting for the proofsToSend to be spent.
   * - COMPLETED: The proofsToSend have been spent.
   * - REVERSED: The swap was reversed before the proofsToSend were spent.
   * - FAILED: The process of swapping for the proofsToSend failed.
   */
  state: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REVERSED' | 'FAILED';
  /**
   * The version of the swap used for optimistic locking.
   */
  version: number;
  /**
   * The id of the transaction that the swap belongs to.
   */
  transactionId: string;
  /**
   * The date the swap was created.
   */
  createdAt: Date;
} & (
  | {
      state: 'DRAFT';
      /**
       * The keyset id used to generate the output data at the time the swap was created.
       */
      keysetId: string;
      /**
       * The keyset counter used to generate the output data at the time the swap was created.
       */
      keysetCounter: number;
      /**
       * The output data used for deterministic outputs when we swap the inputProofs
       * for proofsToSend.
       */
      outputAmounts: {
        /** The output amounts to use when constructing the send output data. */
        send: number[];
        /** The output amounts to use when constructing the change output data. */
        change: number[];
      };
    }
  | {
      state: 'PENDING' | 'COMPLETED';
      /**
       * The hash of the token being sent
       */
      tokenHash: string;
      /**
       * The proofs that will be sent. If we have the exact proofs to send,
       * then this will be the same as inputProofs and no cashu swap will occur.
       * If the inputProofs sum to more than the amount to send, then this
       * will be the result of swapping the inputProofs for the amount to send.
       */
      proofsToSend: CashuProof[];
    }
  | {
      state: 'FAILED';
      failureReason: string;
    }
  | {
      state: 'REVERSED';
    }
);

export type PendingCashuSendSwap = CashuSendSwap & { state: 'PENDING' };
