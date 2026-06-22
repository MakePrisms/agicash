import type { Money } from '@agicash/money';

export type SparkLightningQuote = {
  /**
   * The payment request to pay.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * The amount requested.
   */
  amountRequested: Money;
  /**
   * The amount requested in BTC.
   */
  amountRequestedInBtc: Money<'BTC'>;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The estimated fee.
   */
  estimatedLightningFee: Money<'BTC'>;
  /**
   * The estimated total fee (lightning fee).
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send (amount to receive + estimated lightning fee).
   */
  estimatedTotalAmount: Money;
  /**
   * Whether the payment request has an amount encoded in the invoice.
   */
  paymentRequestIsAmountless: boolean;
  /**
   * The expiry date of the lightning invoice.
   */
  expiresAt: Date | null;
};
