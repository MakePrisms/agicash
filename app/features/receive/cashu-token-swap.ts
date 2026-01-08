import type { Proof } from '@cashu/cashu-ts';
import type { Money } from '~/lib/money';

export type CashuTokenSwapDetails = {
  /**
   * The amount received to the account after all fees.
   */
  amountReceived: Money;
  /**
   * Amount of the token being received in the corresponding currency.
   * Will differ from actual amount received if mint charges fees
   */
  tokenAmount: Money;
  /**
   * The fee that will be deducted from the amount received.
   */
  cashuReceiveFee: Money;
  /**
   * Proofs from the token being received into the account.
   */
  tokenProofs: Proof[];
  /**
   * Amounts for each blinded message.
   * The sum of these values is what will actually be received after fees are deducted
   */
  outputAmounts: number[];
};

/**
 * A token swap is the process of receiving a Cashu token into
 * the user's account that matches the mint of the token by using
 * the `/v1/swap` endpoint of the mint as defined in [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md).
 *
 * A swap is created in the database when a user inputs a token and chooses
 * the matching receive account.
 *
 * All PENDING swaps are tracked upon insert and completed in the background.
 */
export type CashuTokenSwap = {
  /** Hash of the token being received used to identify the swap */
  tokenHash: string;
  /** ID of the user receiving the token */
  userId: string;
  /** ID of the account receiving the token */
  accountId: string;
  /** ID of the keyset used for blinded messages */
  keysetId: string;
  /** Starting counter value used to generate the blinded messages */
  keysetCounter: number;
  /**
   * Current state of the token swap
   *
   * - PENDING: the swap was created, but we still need to swap with the mint and store the proofs
   * - COMPLETED: the swap is completed, and the proofs have been stored
   * - FAILED: the swap failed
   */
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  /**
   * ID of the corresponding transaction
   */
  transactionId: string;
  /** Version of the token swap as seen by the client. Used for optimistic concurrency control. */
  version: number;
  /** Timestamp when the token swap was created */
  createdAt: string;
} & CashuTokenSwapDetails &
  (
    | {
        state: 'PENDING';
      }
    | {
        state: 'COMPLETED';
      }
    | {
        state: 'FAILED';
        failureReason: string;
      }
  );
