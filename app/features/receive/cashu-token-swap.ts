import type { Proof } from '@cashu/cashu-ts';
import type { UnlockingData } from '~/lib/cashu/types';
import type { Money } from '~/lib/money';

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
  /** Proofs from the token being received */
  tokenProofs: Proof[];
  /** ID of the user receiving the token */
  userId: string;
  /** ID of the account receiving the token */
  accountId: string;
  /** Amount of the token being received in the corresponding currency.
   * Will differ from actual amount received if mint charges fees */
  amount: Money;
  /** ID of the keyset used for blinded messages */
  keysetId: string;
  /** Starting counter value used to generate the blinded messages */
  keysetCounter: number;
  /** Amounts for each blinded message.
   * The sum of these values is what will actually be received after fees are deducted */
  outputAmounts: number[];
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
  /** Data that will be used to satisfy the spending condition of the token proofs (signing keys, preimages, etc) */
  unlockingData: UnlockingData | null;
};
