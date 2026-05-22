import type {
  BreezSdk,
  LightningReceiveStatus,
} from '@agicash/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
import type Big from 'big.js';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { type Currency, Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import type { SparkAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';

export type SparkReceiveLightningQuote = {
  /**
   * The unique identifier of this entity across all Lightspark systems. Should be treated as an opaque
   * string.
   **/
  id: string;
  /** The date and time when the entity was first created. **/
  createdAt: string;
  /** The date and time when the entity was last updated. **/
  updatedAt: string;
  /** The lightning invoice generated to receive lightning payment. **/
  invoice: {
    paymentRequest: string;
    paymentHash: string;
    /** Always denominated in sats — the BOLT11 invoice amount. **/
    amount: Money<'BTC'>;
    createdAt: string;
    expiresAt: string;
    memo?: string;
  };
  /**
   * The user-visible amount to be credited to the receiving account.
   * For BTC accounts this equals `invoice.amount`. For USD accounts this is
   * the user-entered USD amount that will be credited once Flashnet's
   * sats → USDB conversion completes.
   */
  amountToReceive: Money;
  /** The status of the request. **/
  status: LightningReceiveStatus;
  /** The receiver's identity public key if different from owner of the request. **/
  receiverIdentityPublicKey?: string;
};

export type GetLightningQuoteParams = {
  /**
   * The Spark wallet to use to get a quote.
   */
  wallet: BreezSdk;
  /**
   * The amount to receive, denominated in the destination account's currency.
   * For USD accounts this is the user-entered USD amount; it will be
   * converted to sats for the BOLT11 invoice.
   */
  amount: Money;
  /**
   * Destination account currency. Defaults to `'BTC'` for callers that
   * pre-date the USDB account work.
   */
  accountCurrency?: Currency;
  /**
   * Required when `accountCurrency === 'USD'` and `amount.currency === 'USD'`.
   * Rate is in `USD-BTC` format (multiply USD cents by rate to get sats).
   */
  exchangeRate?: Big | string;
  /**
   * The Spark public key of the receiver used to create invoices on behalf of another user.
   * If provided, the incoming payment can only be claimed by the Spark wallet that controls the specified public key.
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
  /**
   * The description of the receive request.
   */
  description?: string;
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
   * Optional public key of the wallet receiving the lightning invoice.
   */
  receiverIdentityPubkey?: string;
  /**
   * Total fee for the receive.
   */
  totalFee: Money;
  /**
   * Sats encoded in the BOLT11 invoice. Set when the account currency differs
   * from BTC (e.g. a USD account where the lightning leg settles sats before
   * the auto-conversion to USDB). Typed as a generic `Money` to match the
   * encrypted-blob schema; values are always denominated in sats.
   */
  bolt11AmountSats?: Money;
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
  accountCurrency = 'BTC',
  exchangeRate,
  receiverIdentityPubkey,
  description,
}: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
  let amountSats: number;
  if (accountCurrency === 'USD') {
    if (amount.currency !== 'USD') {
      throw new Error(
        `USD spark receive requires a USD amount; got ${amount.currency}`,
      );
    }
    if (!exchangeRate) {
      throw new Error(
        'Exchange rate is required for USD spark receive quotes',
      );
    }
    amountSats = amount.convert('BTC', exchangeRate).toNumber('sat');
  } else {
    amountSats = amount.toNumber('sat');
  }

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
  if (!response.lightningReceiveDetails) {
    throw new Error(
      'Breez SDK did not return lightningReceiveDetails for a lightning receive',
    );
  }

  const invoice = bolt11.decoded;
  const invoiceAmount: Money<'BTC'> = invoice.amountMsat
    ? new Money({ amount: invoice.amountMsat, currency: 'BTC', unit: 'msat' })
    : new Money({ amount: amountSats, currency: 'BTC', unit: 'sat' });
  const { receiveRequestId, status, createdAt, updatedAt } =
    response.lightningReceiveDetails;

  return {
    id: receiveRequestId,
    createdAt: new Date(createdAt * 1000).toISOString(),
    updatedAt: new Date(updatedAt * 1000).toISOString(),
    invoice: {
      paymentRequest: response.paymentRequest,
      paymentHash: invoice.paymentHash,
      amount: invoiceAmount,
      createdAt: new Date(invoice.createdAtUnixMs).toISOString(),
      expiresAt: new Date(invoice.expiryUnixMs).toISOString(),
      memo: description,
    },
    amountToReceive:
      accountCurrency === 'USD' ? amount : (invoiceAmount as Money),
    status,
    receiverIdentityPublicKey: receiverIdentityPubkey,
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
  const amount = params.lightningQuote.amountToReceive;

  if (params.receiveType === 'LIGHTNING') {
    return { amount, totalFee: Money.zero(amount.currency) };
  }

  return {
    amount,
    totalFee: params.cashuReceiveFee.add(params.lightningFeeReserve),
  };
}
