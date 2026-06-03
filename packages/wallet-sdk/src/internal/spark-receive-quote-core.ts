/**
 * Spark receive-quote CORE — Slice 3 / PR5c (framework-free).
 *
 * EXTRACTED VERBATIM (logic) from
 * `apps/web-wallet/app/features/receive/spark-receive-quote-core.ts`. This module is already
 * framework-free in master (pure `@agicash/breez-sdk-spark` (TYPES only) + `@cashu/cashu-ts`
 * (`Proof` type) + `Money` + `parseBolt11Invoice`) — re-housed here with the SDK-internal
 * imports. It owns:
 *  - {@link getLightningQuote} — creates a Spark Lightning invoice via Breez `receivePayment`;
 *  - {@link computeQuoteExpiry} / {@link getAmountAndFee} — quote bookkeeping;
 *  - the {@link CreateQuoteBaseParams} / {@link RepositoryCreateQuoteParams} param shapes.
 *
 * Re-housing vs master:
 *  - `parseBolt11Invoice` comes from `./lib-scan` (the SDK-internal bolt11 seam), not `~/lib/bolt11`;
 *  - `measureOperation` telemetry around the Breez call is dropped (§3 — same as `spark-wallet.ts`);
 *  - the `BreezSdk` / `LightningReceiveStatus` types are imported TYPE-ONLY from
 *    `@agicash/breez-sdk-spark` (erased, NO WASM load) — the live wallet is passed in by the
 *    caller (PR5a's resolved Breez handle), so this module never imports the native runtime.
 *
 * @module
 */
import type {
  BreezSdk,
  LightningReceiveStatus,
} from '@agicash/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
import { parseBolt11Invoice } from './lib-scan';
import type { SparkAccount } from '../types/account';
import { Money } from '../types/money';

/** The Spark lightning receive quote returned before the quote is persisted (master verbatim). */
export type SparkReceiveLightningQuote = {
  /**
   * The unique identifier of this entity across all Lightspark systems. Should be treated as an
   * opaque string.
   */
  id: string;
  /** The date and time when the entity was first created. */
  createdAt: string;
  /** The date and time when the entity was last updated. */
  updatedAt: string;
  /** The lightning invoice generated to receive lightning payment. */
  invoice: {
    paymentRequest: string;
    paymentHash: string;
    amount: Money<'BTC'>;
    createdAt: string;
    expiresAt: string;
    memo?: string;
  };
  /** The status of the request. */
  status: LightningReceiveStatus;
  /** The receiver's identity public key if different from owner of the request. */
  receiverIdentityPublicKey?: string;
};

/** Params for {@link getLightningQuote} (master verbatim). */
export type GetLightningQuoteParams = {
  /** The Spark wallet (live Breez handle) to create the invoice with. */
  wallet: BreezSdk;
  /** The amount to receive. */
  amount: Money;
  /**
   * The Spark public key of the receiver, used to create invoices on behalf of another user.
   * If provided, the incoming payment can only be claimed by the Spark wallet that controls the
   * specified public key. If not provided, the invoice is created for the wallet's own owner.
   */
  receiverIdentityPubkey?: string;
  /** The description of the receive request (BOLT11 `d` tag). */
  description?: string;
  /**
   * Hex-encoded SHA-256 commitment to a description (BOLT11 `h` tag). When set, Breez SDK emits
   * `h` only and drops `description`.
   */
  descriptionHash?: string;
};

/** Params for creating a spark receive quote in the service (master `CreateQuoteBaseParams`). */
export type CreateQuoteBaseParams = {
  /** The user ID. */
  userId: string;
  /** The Spark account to create the receive request for. */
  account: SparkAccount;
  /** The lightning quote to create the Spark receive quote from. */
  lightningQuote: SparkReceiveLightningQuote;
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer). When not
   * provided, the transaction is created with PAYMENT purpose.
   */
  purpose?: string;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
} & (
  | {
      /** Standard lightning receive. */
      receiveType: 'LIGHTNING';
    }
  | {
      /** Receive cashu tokens to a Spark account (melt-then-pay). */
      receiveType: 'CASHU_TOKEN';
      /** The amount of the token to receive. */
      tokenAmount: Money;
      /** URL of the source mint where the token proofs originate from. */
      sourceMintUrl: string;
      /** The proofs from the source cashu token that will be melted. */
      tokenProofs: Proof[];
      /** ID of the melt quote on the source mint. */
      meltQuoteId: string;
      /** The expiry of the melt quote in ISO 8601 format. */
      meltQuoteExpiresAt: string;
      /** The fee (in the token's unit) incurred for spending the proofs as melt inputs. */
      cashuReceiveFee: Money;
      /** The fee reserved for the lightning payment to melt the token proofs to this account. */
      lightningFeeReserve: Money;
    }
);

/** Params for creating a spark receive quote in the repository (master `RepositoryCreateQuoteParams`). */
export type RepositoryCreateQuoteParams = {
  /** ID of the receiving user. */
  userId: string;
  /** ID of the receiving account. */
  accountId: string;
  /** Amount of the quote. */
  amount: Money;
  /** Lightning payment request. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** Expiry of the quote in ISO 8601 format. */
  expiresAt: string;
  /** Description of the quote. */
  description?: string;
  /** ID of the receive request in the Spark system. */
  sparkId: string;
  /** Optional public key of the wallet receiving the lightning invoice. */
  receiverIdentityPubkey?: string;
  /** Total fee for the receive. */
  totalFee: Money;
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer). When not
   * provided, the transaction is created with PAYMENT purpose.
   */
  purpose?: string;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
} & (
  | {
      /** Standard lightning receive. */
      receiveType: 'LIGHTNING';
    }
  | {
      /** Receive cashu tokens to a Spark account. */
      receiveType: 'CASHU_TOKEN';
      /** The data for the melt operation. */
      meltData: {
        /** URL of the source mint where the token proofs originate from. */
        tokenMintUrl: string;
        /** ID of the melt quote on the source mint. */
        meltQuoteId: string;
        /** The amount of the token to receive. */
        tokenAmount: Money;
        /** The proofs from the source cashu token that will be melted. */
        tokenProofs: Proof[];
        /** The fee paid for spending the token proofs as melt inputs. */
        cashuReceiveFee: Money;
        /** The fee reserved for the lightning payment to melt the token proofs to this account. */
        lightningFeeReserve: Money;
      };
    }
);

/**
 * Get a Breez SDK lightning receive quote for the given amount (master verbatim). Calls Breez
 * `receivePayment` to mint a bolt11 invoice, parses it, and returns the quote + invoice data.
 *
 * @param params - the live wallet, amount, optional receiver pubkey / description / description hash.
 * @returns the Spark lightning receive quote.
 */
export async function getLightningQuote({
  wallet,
  amount,
  receiverIdentityPubkey,
  description,
  descriptionHash,
}: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
  const response = await wallet.receivePayment({
    paymentMethod: {
      type: 'bolt11Invoice',
      description: description ?? '',
      amountSats: amount.toNumber('sat'),
      receiverIdentityPubkey,
      descriptionHash,
    },
  });

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
  const invoiceAmount = invoice.amountMsat
    ? new Money({ amount: invoice.amountMsat, currency: 'BTC', unit: 'msat' })
    : (amount as Money<'BTC'>);
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
    status,
    receiverIdentityPublicKey: receiverIdentityPubkey,
  };
}

/**
 * Compute a receive quote's expiry (master verbatim). LIGHTNING = the lightning invoice expiry;
 * CASHU_TOKEN = the earlier of the lightning + melt quote expiry.
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
 * Get the amount and total fee for a receive quote (master verbatim). LIGHTNING = zero fee;
 * CASHU_TOKEN = cashu receive fee + lightning fee reserve.
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
