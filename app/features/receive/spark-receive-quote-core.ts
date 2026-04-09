import type { BreezSdk } from '@agicash/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { moneyFromSats } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';

export type SparkReceiveLightningQuote = {
  /**
   * Unique identifier for tracking — equals the payment hash.
   */
  id: string;
  invoice: {
    paymentRequest: string;
    paymentHash: string;
    amount: Money<'BTC'>;
    expiresAt: string;
    memo?: string;
  };
  fee: Money<'BTC'>;
};

export type GetLightningQuoteParams = {
  /**
   * The Breez SDK instance to use to get a quote.
   */
  wallet: BreezSdk;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * The description of the receive request.
   */
  description?: string;
  /**
   * Hex-encoded compressed public key of the receiver.
   * When set, creates a delegated invoice — the SSP routes the payment to this
   * identity instead of the caller's wallet. Used for Lightning Address flows
   * where a server creates invoices on behalf of users.
   */
  receiverIdentityPubkey?: string;
};

export type CreateQuoteBaseParams = {
  /**
   * The user ID.
   */
  userId: string;
  /**
   * The Spark account to create the receive request for.
   */
  account: SparkAccount;
  /**
   * The lightning quote to create the Spark receive quote from.
   */
  lightningQuote: SparkReceiveLightningQuote;
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer).
   * When not provided, the transaction will be created with PAYMENT purpose.
   */
  purpose?: TransactionPurpose;
  /**
   * UUID linking paired send/receive transactions in a transfer.
   */
  transferId?: string;
} & (
  | {
      /**
       * Type of the receive.
       * LIGHTNING - Standard lightning receive.
       */
      receiveType: 'LIGHTNING';
    }
  | {
      /**
       * Type of the receive.
       * CASHU_TOKEN - Receive cashu tokens to a Spark account.
       */
      receiveType: 'CASHU_TOKEN';
      /**
       * The amount of the token to receive.
       */
      tokenAmount: Money;
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
       * The expiry of the melt quote in ISO 8601 format.
       */
      meltQuoteExpiresAt: string;
      /**
       * The fee (in the unit of the token) that will be incurred for spending the proofs as inputs to the melt operation.
       */
      cashuReceiveFee: Money;
      /**
       * The fee reserved for the lightning payment to melt the token proofs to this account.
       */
      lightningFeeReserve: Money;
    }
);

export type RepositoryCreateQuoteParams = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * Lightning payment request.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Description of the quote.
   */
  description?: string;
  /**
   * ID of the receive request in the Spark system.
   */
  sparkId: string;
  /**
   * Total fee for the receive.
   */
  totalFee: Money;
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer).
   * When not provided, the transaction will be created with PAYMENT purpose.
   */
  purpose?: TransactionPurpose;
  /**
   * UUID linking paired send/receive transactions in a transfer.
   */
  transferId?: string;
} & (
  | {
      /**
       * Type of the receive.
       * LIGHTNING - Standard lightning receive.
       */
      receiveType: 'LIGHTNING';
    }
  | {
      /**
       * Type of the receive.
       * CASHU_TOKEN - Receive cashu tokens to a Spark account.
       */
      receiveType: 'CASHU_TOKEN';
      /**
       * The data for the melt operation.
       */
      meltData: {
        /**
         * URL of the source mint where the token proofs originate from.
         */
        tokenMintUrl: string;
        /**
         * ID of the melt quote on the source mint.
         */
        meltQuoteId: string;
        /**
         * The amount of the token to receive.
         */
        tokenAmount: Money;
        /**
         * The proofs from the source cashu token that will be melted.
         */
        tokenProofs: Proof[];
        /**
         * The fee that is paid for spending the token proofs as inputs to the melt operation.
         */
        cashuReceiveFee: Money;
        /**
         * The fee reserved for the lightning payment to melt the token proofs to this account.
         */
        lightningFeeReserve: Money;
      };
    }
);

/**
 * Gets a Breez SDK lightning receive quote for the given amount.
 * This is a pure function that calls Breez SDK and can be used by both client and server.
 * @returns The Spark lightning receive quote.
 */
export async function getLightningQuote({
  wallet,
  amount,
  description,
  receiverIdentityPubkey,
}: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
  const amountSats = amount.toNumber('sat');

  const response = await measureOperation('BreezSdk.receivePayment', () =>
    wallet.receivePayment({
      paymentMethod: {
        type: 'bolt11Invoice',
        description: description ?? '',
        amountSats,
        receiverIdentityPubkey,
      },
    }),
  );

  const bolt11 = parseBolt11Invoice(response.paymentRequest);
  if (!bolt11.valid) {
    throw new Error('Breez SDK returned an invalid bolt11 invoice');
  }

  const invoice = bolt11.decoded;
  const invoiceAmount = invoice.amountMsat
    ? new Money({ amount: invoice.amountMsat, currency: 'BTC', unit: 'msat' })
    : new Money({ amount: amountSats, currency: 'BTC', unit: 'sat' });

  return {
    id: invoice.paymentHash,
    invoice: {
      paymentRequest: response.paymentRequest,
      paymentHash: invoice.paymentHash,
      amount: invoiceAmount,
      expiresAt: invoice.expiryUnixMs
        ? new Date(invoice.expiryUnixMs).toISOString()
        : new Date(Date.now() + 3600_000).toISOString(),
      memo: description,
    },
    fee: moneyFromSats(0),
  };
}

/**
 * Computes the expiry date for a quote.
 * For LIGHTNING type, returns the lightning invoice expiry.
 * For CASHU_TOKEN type, returns the earlier of lightning and melt quote expiry.
 */
export function computeQuoteExpiry(params: CreateQuoteBaseParams): string {
  if (params.receiveType === 'LIGHTNING') {
    return params.lightningQuote.invoice.expiresAt;
  }

  return new Date(
    Math.min(
      new Date(params.lightningQuote.invoice.expiresAt).getTime(),
      new Date(params.meltQuoteExpiresAt).getTime(),
    ),
  ).toISOString();
}

/**
 * Gets the amount and total fee for a receive quote.
 * @param params - The parameters for the receive quote.
 * @returns The amount and total fee for the receive quote.
 */
export function getAmountAndFee(params: CreateQuoteBaseParams): {
  amount: Money;
  totalFee: Money;
} {
  const amount = params.lightningQuote.invoice.amount as Money;

  if (params.receiveType === 'LIGHTNING') {
    return { amount, totalFee: Money.zero(amount.currency) };
  }

  return {
    amount,
    totalFee: params.cashuReceiveFee.add(params.lightningFeeReserve),
  };
}
