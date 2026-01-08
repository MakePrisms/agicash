import type { Money } from '~/lib/money';
import type { CashuProof } from '../accounts/account';

/**
 * The output amounts used for deterministic outputs when swapping inputProofs for proofsToSend.
 */
export type CashuSendSwapOutputAmounts = {
  /** The output amounts to use when constructing the send output data. */
  send: number[];
  /** The output amounts to use when constructing the change output data. */
  change: number[];
};

export type CashuSendSwapDetails = {
  /**
   * This is the sum of `amountToReceive` and `totalFees`, and is the amount deducted from the account.
   */
  amountSpent: Money;
  /**
   * This is the amount the recipient will receive after fees have been paid.
   */
  amountToReceive: Money;
  /**
   * The fee incurred when creating sendable proofs.
   */
  cashuSendFee: Money;
  /**
   * The fee that we include in the token for the receiver to claim exactly `amountToReceive`.
   */
  cashuReceiveFee: Money;
  /**
   * The total fees for the transaction. Sum of cashuSendFee and cashuReceiveFee.
   */
  totalFees: Money;
  /**
   * The sum of the input proofs in the account's currency.
   */
  inputAmount: Money;
  /**
   * The amount to send in the account's currency.
   */
  amountToSend: Money;
  /**
   * The requested amount to send in the account's currency.
   */
  amountRequested: Money;
  /**
   * The output amounts used for the swap.
   */
  outputAmounts?: CashuSendSwapOutputAmounts;
};

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
type CashuSendSwapBase = {
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
};

type CashuSendSwapByState =
  | {
      /**
       * State of the cashu send swap.
       * DRAFT: The swap entity has been created, but there are no proofs to send yet. At this point,
       * we have only taken the inputProofs from the account.
       */
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
       * The output amounts used for deterministic outputs when we swap the inputProofs for proofsToSend.
       */
      outputAmounts: CashuSendSwapOutputAmounts;
    }
  | {
      /**
       * State of the cashu send swap.
       * PENDING: There are proofs to send and the swap is waiting for the proofsToSend to be spent.
       * COMPLETED: The proofsToSend have been spent.
       */
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
      /**
       * The output amounts that were used for the swap.
       */
      outputAmounts: CashuSendSwapOutputAmounts;
    }
  | {
      /**
       * State of the cashu send swap.
       * FAILED: The process of swapping for the proofsToSend failed.
       */
      state: 'FAILED';
      /**
       * Reason this swap failed.
       */
      failureReason: string;
    }
  | {
      /**
       * State of the cashu send swap.
       * REVERSED: The swap was reversed before the proofsToSend were spent.
       */
      state: 'REVERSED';
    };

export type CashuSendSwap = CashuSendSwapBase & CashuSendSwapByState;

export type PendingCashuSendSwap = CashuSendSwap & { state: 'PENDING' };
