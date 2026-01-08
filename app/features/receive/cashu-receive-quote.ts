import type { Proof } from '@cashu/cashu-ts';
import type { Money } from '~/lib/money';

export type CashuReceiveQuoteDetailsBase = {
  /**
   * The mint quote ID.
   */
  quoteId: string;
  /**
   * The amount received to the account after all fees.
   */
  amountReceived: Money;
  /**
   * The bolt11 payment request.
   */
  paymentRequest: string;
  /**
   * Amounts for each blinded message created for this receive.
   * Populated after payment is processed (PAID/COMPLETED states).
   */
  outputAmounts?: number[];
  /**
   * The fee charged by the mint to mint ecash.
   */
  mintingFee?: Money;
};

export type LightningCashuReceiveQuoteDetails = CashuReceiveQuoteDetailsBase & {
  /**
   * The description of the receive.
   */
  description?: string;
};

/**
 * Data related to cross-account cashu token receives.
 * Present only for TOKEN type quotes.
 */
type TokenReceiveCashuReceiveQuoteDetails = {
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

export type TokenCashuReceiveQuoteDetails = CashuReceiveQuoteDetailsBase & {
  /**
   * The amount of the token being claimed.
   */
  tokenAmount: Money;
  /**
   * The fee incurred when swapping/melting proofs.
   */
  cashuReceiveFee: Money;
  /**
   * The fee reserved for the lightning payment to melt the token proofs to this account.
   */
  lightningFeeReserve?: Money;
  /**
   * The total fees for the receive. Sum of cashuReceiveFee, lightningFeeReserve, and mintingFee.
   */
  totalFees: Money;
  /**
   * Data related to cross-account cashu token receives.
   */
  tokenReceiveData: Omit<TokenReceiveCashuReceiveQuoteDetails, 'meltInitiated'>;
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
   * Date and time the receive quote was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the receive quote expires in ISO 8601 format.
   */
  expiresAt: string;
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
};

type CashuReceiveQuoteByType =
  | ({
      /**
       * Type of the receive.
       * LIGHTNING - The money is received via Lightning.
       */
      type: 'LIGHTNING';
    } & LightningCashuReceiveQuoteDetails)
  | ({
      /**
       * Type of the receive.
       * CASHU_TOKEN - The money is received as cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
       *               Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
       */
      type: 'CASHU_TOKEN';
      /**
       * Data related to cross-account cashu token receives.
       */
      tokenReceiveData: TokenReceiveCashuReceiveQuoteDetails;
    } & TokenCashuReceiveQuoteDetails);

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
