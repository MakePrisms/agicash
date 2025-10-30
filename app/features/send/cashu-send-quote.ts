import type { Money } from '~/lib/money';
import type { CashuProof } from '../accounts/account';

export type CashuSendQuote = {
  id: string;
  /**
   * Date and time the send was created in ISO 8601 format.
   */
  createdAt: string;
  /**
   * Date and time the send quote expires in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * ID of the user that the quote belongs to.
   */
  userId: string;
  /**
   * ID of the Agicash account to send from.
   */
  accountId: string;
  /**
   * Payment request that is a destination of the send.
   */
  paymentRequest: string;
  /**
   * Amount requested to send.
   * For payment requests that have the amount defined, the amount will match what is defined in the request and will always be in BTC currency.
   * For amountless payment requests, the amount will be the amount defined by the sender (what gets sent to mint in this case is this amount converted to BTC using our exchange rate at the time of quote creation).
   */
  amountRequested: Money;
  /**
   * Amount requested to send converted to milli-satoshis.
   * For amountless payment requests, this is the amount that gets sent to the mint when creating a melt quote.
   * It will be the amount requested converted to milli-satoshis using our exchange rate at the time of quote creation.
   */
  amountRequestedInMsat: number;
  /**
   * Amount that the receiver will receive.
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do the conversion using their exchange rate at the time of quote creation.
   */
  amountToReceive: Money;
  /**
   * Fee reserve for the lightning network fee.
   * Currency will be the same as the currency of the account we are sending from.
   * If payment ends up being cheaper than the fee reserve, the difference will be returned as change.
   */
  lightningFeeReserve: Money;
  /**
   * Cashu mint fee for the proofs used.
   * Currency will be the same as the currency of the account we are sending from.
   */
  cashuFee: Money;
  /**
   * ID of the melt quote.
   */
  quoteId: string;
  /**
   * Cashu proofs to melt.
   * Amounts are denominated in the cashu units (e.g. sats for BTC accounts, cents for USD accounts).
   * Sum of the proof amounts is equal or greater than the amount to send plus the fee reserve. Any overflow will be returned as change.
   */
  proofs: CashuProof[];
  /**
   * ID of the keyset used for the send.
   */
  keysetId: string;
  /**
   * Counter value for the keyset at the time the time of send.
   */
  keysetCounter: number;
  /**
   * Number of ouputs that will be used for the send change.
   */
  numberOfChangeOutputs: number;
  /**
   * State of the send quote.
   */
  state: 'UNPAID' | 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: number;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
} & (
  | {
      state: 'UNPAID';
    }
  | {
      state: 'PENDING';
    }
  | {
      state: 'EXPIRED';
    }
  | {
      state: 'FAILED';
      /**
       * Reason for the failure of the send quote.
       */
      failureReason: string;
    }
  | {
      state: 'PAID';
      /**
       * Lightning payment preimage.
       */
      paymentPreimage: string;
      /**
       * Total amount spent on the lightning payment.
       * This is the amount to send plus the actual fee paid to the lightning network.
       * Currency will be the same as the currency of the account we are sending from.
       */
      amountSpent: Money;
    }
);
