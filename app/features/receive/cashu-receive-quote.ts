import type { Proof } from '@cashu/cashu-ts';
import type { Money } from '~/lib/money';

/**
 * Data related to cross-account cashu token receives.
 * Present only for TOKEN type quotes.
 */
export type CashuReceiveQuoteTokenReceiveData = {
  /**
   * URL of the source mint where the token proofs originate from.
   */
  sourceMintUrl: string;
  /**
   * The proofs from the source cashu token that will be melted.
   */
  tokenProofs: Proof[];
  /**
   * ID of the melt quote on the source mint.
   */
  meltQuoteId: string;
  /**
   * Whether the melt has been initiated on the source mint.
   */
  meltInitiated: boolean;
};

type CashuReceiveQuoteBase = {
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
   * Payment request for the quote.
   */
  paymentRequest: string;
  /**
   * Payment hash of the quote's lightning invoice.
   */
  paymentHash: string;
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
};

type CashuReceiveQuoteByType =
  | {
      /**
       * Type of the receive.
       * LIGHTNING - The money is received via Lightning.
       */
      type: 'LIGHTNING';
    }
  | {
      /**
       * Type of the receive.
       * CASHU_TOKEN - The money is received as cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
       *               Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
       */
      type: 'CASHU_TOKEN';
      /**
       * Data related to cross-account cashu token receives.
       */
      tokenReceiveData: CashuReceiveQuoteTokenReceiveData;
      /**
       * The amount of the token being claimed.
       */
      tokenAmount: Money;
      /**
       * The fee that will be incurred when swapping proofs to the account.
       */
      cashuReceiveFee: Money;
      /**
       * The fee reserved for the lightning payment to melt the proofs to the account.
       * This is defined when the token is melted from the source mint into this receiving account.
       * This will be undefined when receiving proofs to the source account which just requires a swap.
       */
      lightningFeeReserve?: Money;
      /**
       * The total fees for the transaction.
       */
      totalFees: Money;
    };

type CashuReceiveQuoteByState =
  | {
      /**
       * State of the cashu receive quote.
       */
      state: 'UNPAID' | 'EXPIRED';
    }
  | {
      /**
       * State of the cashu receive quote.
       */
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
      /**
       * State of the cashu receive quote.
       */
      state: 'FAILED';
      /**
       * Reason this quote was failed.
       */
      failureReason: string;
    };

export type CashuReceiveQuote = CashuReceiveQuoteBase &
  CashuReceiveQuoteByType &
  CashuReceiveQuoteByState;
