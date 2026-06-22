import type { Money } from '@agicash/money';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';

export type CashuLightningQuote = {
  /**
   * The payment request to pay.
   */
  paymentRequest: string;
  /**
   * The amount requested.
   */
  amountRequested: Money;
  /**
   * The amount requested in BTC.
   */
  amountRequestedInBtc: Money<'BTC'>;
  /**
   * The mint's melt quote.
   */
  meltQuote: MeltQuoteBolt11Response;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The maximum lightning network fee that will be charged for the send.
   * If the amount reserved is bigger than the actual fee, the difference will be returned to the senderas change.
   */
  lightningFeeReserve: Money;
  /**
   * Estimated cashu mint fee that will be charged for the proofs melted.
   * Actual fee might be different if the proofs selected at the time when the send is confirmed are different from the ones used to create the quote.
   */
  estimatedCashuFee: Money;
  /**
   * Estimated total fee (lightning fee reserve + estimated cashu fee).
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send (amount to receive + lightning fee reserve + estimated cashu fee).
   */
  estimatedTotalAmount: Money;
  /**
   * The expiry date of the lightning invoice.
   */
  expiresAt: Date | null;
};
