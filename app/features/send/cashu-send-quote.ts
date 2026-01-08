import type { Money } from '~/lib/money';
import type { CashuProof } from '../accounts/account';
import type { DestinationDetails } from '../transactions/transaction';

export type CashuSendQuoteDetailsBase = {
  /**
   * The sum of all proofs used as inputs to the cashu melt operation
   * converted from a number to Money in the currency of the account.
   * These proofs are moved from the account to the pending send quote.
   * When the transaction is completed, change will be returned to the account.
   */
  amountReserved: Money;
  /**
   * Amount that the receiver will receive.
   *
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do
   * the conversion using their exchange rate at the time of quote creation.
   */
  amountToReceive: Money;
  /**
   * The amount reserved upfront to cover the maximum potential Lightning Network fees.
   *
   * If the actual Lightning fee ends up being lower than this reserve,
   * the difference is returned as change to the user.
   */
  lightningFeeReserve: Money;
  /**
   * Cashu mint fee for the proofs used.
   */
  cashuFee: Money;
  /**
   * The bolt11 payment request.
   */
  paymentRequest: string;
  /**
   * Additional details related to the transaction.
   *
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails?: DestinationDetails;
  /**
   * Amount requested to send in the original currency.
   */
  amountRequested: Money;
  /**
   * Amount requested to send converted to milli-satoshis.
   */
  amountRequestedInMsat: number;
  /**
   * Id of the melt quote.
   */
  quoteId: string;
};

export type CompletedCashuSendQuoteDetails = CashuSendQuoteDetailsBase & {
  /**
   * This is the sum of `amountToReceive` and `totalFees`. This is the amount deducted from the account.
   */
  amountSpent: Money;
  /**
   * The preimage of the lightning payment.
   * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'
   */
  paymentPreimage: string;
  /**
   * The actual Lightning Network fee that was charged after the transaction completed.
   * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
   *
   * The difference between the `lightningFeeReserve` and the `lightningFee` is returned as change to the user.
   */
  lightningFee: Money;
  /**
   * The actual fees for the transaction. Sum of lightningFee and cashuFee.
   */
  totalFees: Money;
};

export type CashuSendQuoteDetails =
  | CashuSendQuoteDetailsBase
  | CompletedCashuSendQuoteDetails;

type CashuSendQuoteBase = {
  /**
   * UUID of the quote.
   */
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
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
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
   * Number of outputs that will be used for the send change.
   */
  numberOfChangeOutputs: number;
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: number;
  /**
   * ID of the corresponding transaction.
   */
  transactionId: string;
};

type CashuSendQuoteByState =
  | ({
      state: 'UNPAID';
    } & CashuSendQuoteDetailsBase)
  | ({
      state: 'PENDING';
    } & CashuSendQuoteDetailsBase)
  | ({
      state: 'EXPIRED';
    } & CashuSendQuoteDetailsBase)
  | ({
      state: 'FAILED';
      /**
       * Reason for the failure of the send quote.
       */
      failureReason: string;
    } & CashuSendQuoteDetailsBase)
  | ({
      state: 'PAID';
    } & CompletedCashuSendQuoteDetails);

/**
 * Represents a Cashu send quote.
 * This is created when a user initiates a lightning payment through their Cashu wallet.
 * The quote starts in UNPAID state, transitions to PENDING when payment is initiated,
 * and finally to PAID, EXPIRED, or FAILED based on the payment result.
 */
export type CashuSendQuote = CashuSendQuoteBase & CashuSendQuoteByState;
