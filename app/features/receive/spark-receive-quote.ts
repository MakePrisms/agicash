import type { Proof } from '@cashu/cashu-ts';
import type { Money } from '~/lib/money';

export type SparkReceiveQuoteDetailsBase = {
  /**
   * The amount received to the account after all fees.
   */
  amountReceived: Money;
  /**
   * The bolt11 payment request.
   */
  paymentRequest: string;
};

export type LightningSparkReceiveQuoteDetails = SparkReceiveQuoteDetailsBase & {
  /**
   * The description of the receive.
   */
  description?: string;
};

export type CompletedLightningSparkReceiveQuoteDetails =
  LightningSparkReceiveQuoteDetails & {
    /**
     * Payment preimage from the lightning payment.
     */
    paymentPreimage: string;
  };

/**
 * Data related to cashu token receives to Spark accounts.
 * Present only for CASHU_TOKEN type quotes.
 */
type TokenReceiveSparkReceiveQuoteDetails = {
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

export type TokenSparkReceiveQuoteDetails = SparkReceiveQuoteDetailsBase & {
  /**
   * The amount of the token being claimed.
   */
  tokenAmount?: Money;
  /**
   * The fee reserved for the lightning payment to melt the token proofs to this account.
   */
  lightningFeeReserve?: Money;
  /**
   * The total fees for the receive.
   */
  totalFees?: Money;
  /**
   * Data related to cashu token receives to Spark accounts.
   */
  tokenReceiveData: Omit<TokenReceiveSparkReceiveQuoteDetails, 'meltInitiated'>;
};

export type CompletedTokenSparkReceiveQuoteDetails =
  TokenSparkReceiveQuoteDetails & {
    /**
     * Payment preimage from the lightning payment.
     */
    paymentPreimage: string;
  };

type SparkReceiveQuoteBase = {
  id: string;
  /**
   * ID of the receive request in Spark system.
   */
  sparkId: string;
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
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Optional public key of the wallet receiving the lightning invoice.
   */
  receiverIdentityPubkey?: string;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
  /**
   * Row version. Used for optimistic locking.
   */
  version: number;
};

type SparkReceiveQuoteByType =
  | ({
      /**
       * Type of the receive.
       * LIGHTNING - The money is received via regular Lightning flow. User provides the lightning invoice to the payer who then pays the invoice.
       */
      type: 'LIGHTNING';
    } & LightningSparkReceiveQuoteDetails)
  | ({
      /**
       * Type of the receive.
       * CASHU_TOKEN - The money is received as cashu token. User provides the cashu token and cashu proofs are then melted by the Agicash app and used to pay Spark lightning invoice.
       *               Used for receiving cashu tokens to Spark accounts.
       */
      type: 'CASHU_TOKEN';
      /**
       * Data related to cross-account cashu token receives.
       */
      tokenReceiveData: TokenReceiveSparkReceiveQuoteDetails;
    } & TokenSparkReceiveQuoteDetails);

type SparkReceiveQuoteByState =
  | {
      /**
       * State of the spark receive quote.
       */
      state: 'UNPAID' | 'EXPIRED';
    }
  | {
      /**
       * State of the spark receive quote.
       */
      state: 'PAID';
      /**
       * Payment preimage.
       */
      paymentPreimage: string;
      /**
       * Spark transfer ID.
       */
      sparkTransferId: string;
    }
  | {
      /**
       * State of the spark receive quote.
       */
      state: 'FAILED';
      /**
       * Reason this quote was failed.
       */
      failureReason: string;
    };

export type SparkReceiveQuote = SparkReceiveQuoteBase &
  SparkReceiveQuoteByType &
  SparkReceiveQuoteByState;
