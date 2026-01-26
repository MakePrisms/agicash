import type { SparkWallet } from '@buildonspark/spark-sdk';
import type {
  BitcoinNetwork,
  CurrencyAmount,
  LightningReceiveRequestStatus,
} from '@buildonspark/spark-sdk/types';
import type { Proof } from '@cashu/cashu-ts';
import { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';

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
  /** The network the lightning send request is on. **/
  network: BitcoinNetwork;
  /** The lightning invoice generated to receive lightning payment. **/
  invoice: {
    encodedInvoice: string;
    paymentHash: string;
    amount: CurrencyAmount;
    createdAt: string;
    expiresAt: string;
    memo?: string | undefined;
  };
  /** The status of the request. **/
  status: LightningReceiveRequestStatus;
  /** The typename of the object **/
  typename: string;
  /** The payment preimage of the invoice if retrieved from SE. **/
  paymentPreimage?: string | undefined;
  /** The receiver's identity public key if different from owner of the request. **/
  receiverIdentityPublicKey?: string | undefined;
};

export type GetLightningQuoteParams = {
  /**
   * The Spark wallet to use to get a quote.
   */
  wallet: SparkWallet;
  /**
   * The amount to receive.
   */
  amount: Money;
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
 * Gets a Spark lightning receive quote for the given amount.
 * This is a pure function that calls Spark SDK and can be used by both client and server.
 * @returns The Spark lightning receive quote.
 */
export async function getLightningQuote({
  wallet,
  amount,
  receiverIdentityPubkey,
  description,
}: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
  const response = await wallet.createLightningInvoice({
    amountSats: amount.toNumber('sat'),
    includeSparkAddress: false,
    receiverIdentityPubkey,
    memo: description,
  });
  return {
    id: response.id,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    network: response.network,
    invoice: {
      encodedInvoice: response.invoice.encodedInvoice,
      paymentHash: response.invoice.paymentHash,
      amount: response.invoice.amount,
      createdAt: response.invoice.createdAt,
      expiresAt: response.invoice.expiresAt,
      // We are using `?? undefined` for this and some properties below because, even though Spark types for those are defined as T | undefined,
      // in practice we have seen null values, and we want to make sure that SparkReceiveLightningQuote is strictly correct.
      memo: response.invoice.memo ?? undefined,
    },
    status: response.status,
    typename: response.typename,
    paymentPreimage: response.paymentPreimage ?? undefined,
    receiverIdentityPublicKey: response.receiverIdentityPublicKey ?? undefined,
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
  const amount = moneyFromSparkAmount(params.lightningQuote.invoice.amount);

  if (params.receiveType === 'LIGHTNING') {
    return { amount, totalFee: Money.zero(amount.currency) };
  }

  return {
    amount,
    totalFee: params.cashuReceiveFee.add(params.lightningFeeReserve),
  };
}
