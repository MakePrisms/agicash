import type { OutputData, Proof } from '@cashu/cashu-ts';
import type { Currency, Money } from '~/lib/money';

/**
 * A CashuSendSwap takes proofs from an account and creates proofs to send
 * which can then be encoded into a token.
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
  inputProofs: Proof[];
  /**
   * The sum of the inputProofs
   */
  inputAmount: Money;
  /**
   * The amount requested to send by the user.
   */
  amountRequested: Money;
  /**
   * The request amount to send plus the receiveSwapFee.
   * proofsToSend will sum to this amount.
   */
  amountToSend: Money;
  /**
   * The swap fee that will be incurred when the receiver claims the token.
   */
  receiveSwapFee: Money;
  /**
   * The swap fee that will be incurred when swapping the inputProofs for the proofsToSend.
   */
  sendSwapFee: Money; // QUESTION: if we don't need to swap this will be 0, should it be undefined here or 0?
  /**
   * The currency of the account and all amounts.
   */
  currency: Currency;
  /**
   * The mint url of the account which should match the mint that issues the proofs.
   */
  mintUrl: string;
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
       * The output data used for deterministic outputs when we swap the inputProofs
       * for proofsToSend.
       */
      outputData: {
        /** Output data for the change from the swap. */
        keep: OutputData[];
        /** Output data for the amount to send. */
        send: OutputData[];
      };
      /**
       * The keyset counter used to generate the output data at the time the swap was created.
       */
      keysetCounter: number;
      /**
       * The keyset id used to generate the output data at the time the swap was created.
       */
      keysetId: string;
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
      proofsToSend: Proof[];
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
