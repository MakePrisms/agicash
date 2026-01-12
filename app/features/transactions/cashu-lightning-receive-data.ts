import type { Proof } from '@cashu/cashu-ts';
import type { Currency, Money } from '~/lib/money';

export type CashuLightningReceiveData = {
  /**
   * Bolt 11 payment request.
   */
  paymentRequest: string;

  /**
   * ID of the mint quote for this receive.
   */
  mintQuoteId: string;

  /**
   * The amount credited to the account.
   */
  amountReceived: Money<Currency>;

  /**
   * The description of the transaction.
   */
  description?: string | undefined;

  /**
   * The fee charged by the mint to deposit money into the account.
   */
  mintingFee?: Money<Currency> | undefined;

  /**
   * Amounts for each blinded message created for this receive.
   * Will be set only when the receive quote gets paid.
   */
  outputAmounts?: number[];

  /**
   * The data of the cashu token melted for the receive.
   * This will be set only for cashu token receives when the destination account is not the mint that issued the token (the token was melted to pay the lightning invoice of the mint quote from the destination mint).
   */
  cashuTokenData?:
    | {
        /**
         * The mint which issued the token.
         */
        tokenMintUrl: string;

        /**
         * ID of the melt quote that was executed to melt the cashu token to pay for the mint quote.
         */
        meltQuoteId: string;

        /**
         * The amount of the token melted.
         */
        tokenAmount: Money<Currency>;

        /**
         * The proofs of cashu token melted.
         */
        tokenProofs: Proof[];

        /**
         * The fee that is paid for spending the token proofs as inputs to the melt operation.
         */
        cashuReceiveFee: Money<Currency>;

        /**
         * The fee reserved for the lightning payment to melt the token proofs to this account.
         */
        lightningFeeReserve: Money;

        // TODO: I think we don't store actual ln fee after the melt for cross account cashu token receives
      }
    | undefined;

  /**
   * The total fees for the transaction.
   * Sum of the mintingFee, cashuReceiveFee and lightningFeeReserve.
   */
  totalFees: Money;
};
