import type { Money } from '~/lib/money';

export type CashuReceiveQuote = {
  id: string;
  /**
   * ID of the user that the quote belongs to.
   */
  userId: string;
  /**
   * ID of the Agicash account that the quote belongs to.
   */
  accountId: string;
  /**
   * ID of the mint quote.
   * Once the quote is paid, the mint quote id is used to mint the tokens.
   */
  quoteId: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * Description of the receivequote.
   */
  description?: string;
  /**
   * Date and time the receive quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the receive quote expires in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Type of the receive.
   * LIGHTNING - The money is received via Lightning.
   * TOKEN - The money is received as cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
   *         Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
   */
  type: 'LIGHTNING' | 'TOKEN';
  /**
   * State of the cashu receive quote.
   */
  state: 'UNPAID' | 'EXPIRED' | 'PAID' | 'COMPLETED' | 'FAILED';
  /**
   * Payment request for the quote.
   */
  paymentRequest: string;
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: number;
  /**
   * BIP32 derivation path used for locking and signing the quote.
   * This is the full path used to derive the locking key from the cashu seed.
   * The last index is unhardened so that we can derive public keys without requiring the private key.
   * @example "m/129372'/0'/0'/4321"
   */
  lockingDerivationPath: string;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
  /**
   * Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount.
   */
  mintingFee?: Money;
} & (
  | {
      state: 'UNPAID' | 'EXPIRED';
    }
  | {
      state: 'PAID' | 'COMPLETED';
      /**
       * ID of the keyset used to create the blinded messages.
       */
      keysetId: string;
      /**
       * Counter value for the keyset at the time the time of quote payment.
       */
      keysetCounter: number;
      /**
       * Amounts for each blinded message created for this receive.
       */
      outputAmounts: number[];
    }
  | {
      state: 'FAILED';
      /**
       * Reason this quote was failed.
       */
      failureReason: string;
    }
);
