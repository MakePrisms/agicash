import type {
  NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import {
  type LightningSendRequest,
  LightningSendRequestStatus,
  type WalletTransfer,
} from '@buildonspark/spark-sdk/types';
import { useQueryClient } from '@tanstack/react-query';
import type { Big } from 'big.js';
import { useMemo } from 'react';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { type Currency, Money } from '~/lib/money';
import type { SparkAccount } from '../accounts/account';
import { DomainError } from '../shared/error';
import { getSparkWalletFromCache } from '../shared/spark';

function isWalletTransfer(
  request: LightningSendRequest | WalletTransfer,
): request is WalletTransfer {
  return 'createdTime' in request && 'totalValue' in request;
}

type GetSparkLightningQuoteOptions = {
  /**
   * The account to send the money from.
   */
  account: SparkAccount;
  /**
   * Bolt 11 lightning invoice to pay.
   */
  paymentRequest: string;
  /**
   * The amount to send. Needs to be provided in case of amountless lightning invoice.
   * If the invoice has an amount and this is provided, it will be ignored.
   */
  amount?: Money;
  /**
   * The exchange rate to be used to convert the amount to milli-satoshis.
   * Must be provided if amount is provided in any currency other than BTC. Otherwise the exception will be thrown.
   */
  exchangeRate?: Big;
};

export type SparkLightningQuote = {
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
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The maximum lightning network fee that will be charged for the send.
   */
  lightningFeeReserve: Money;
  /**
   * Estimated total fee (same as lightningFeeReserve for Spark).
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send (amount to receive + lightning fee reserve).
   */
  estimatedTotalAmount: Money;
};

export type SparkSendQuote = {
  /**
   * The ID of the Lightning send request.
   */
  id: string;
  /**
   * The ID of the account to send from.
   */
  accountId: string;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  paymentRequest: string;
  sendRequest: LightningSendRequest;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  /**
   * Lightning network fee reserve in sats.
   */
  lightningFeeReserve: Money;
  /**
   * Actual lightning fee paid in sats (only available after completion).
   */
  actualFeeSats?: number;
  transferId?: string;
};

export class SparkSendLightningService {
  constructor(
    private readonly getWallet: (
      network: SparkNetwork,
    ) => SparkWallet | undefined,
  ) {}

  async getLightningQuote({
    account,
    paymentRequest,
    amount,
    exchangeRate,
  }: GetSparkLightningQuoteOptions): Promise<SparkLightningQuote> {
    const sparkWallet = this.getWallet(account.network);
    if (!sparkWallet) {
      throw new Error(
        `Spark wallet not initialized for network ${account.network}`,
      );
    }

    const bolt11ValidationResult = parseBolt11Invoice(paymentRequest);
    if (!bolt11ValidationResult.valid) {
      throw new DomainError('Invalid lightning invoice');
    }
    const invoice = bolt11ValidationResult.decoded;

    if (invoice.expiryUnixMs && new Date(invoice.expiryUnixMs) < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    let amountRequestedInBtc = new Money({
      amount: 0,
      currency: 'BTC',
    });

    if (invoice.amountMsat) {
      amountRequestedInBtc = new Money({
        amount: invoice.amountMsat,
        currency: 'BTC',
        unit: 'msat',
      });
    } else if (amount) {
      if (amount.currency === 'BTC') {
        amountRequestedInBtc = amount as Money<'BTC'>;
      } else if (exchangeRate) {
        amountRequestedInBtc = amount.convert('BTC', exchangeRate);
      } else {
        throw new Error('Exchange rate is required for non-BTC amounts');
      }
    } else {
      throw new Error('Amount required for zero-amount invoices');
    }

    const estimatedFeeSats = await sparkWallet.getLightningSendFeeEstimate({
      encodedInvoice: paymentRequest,
      amountSats: amountRequestedInBtc.toNumber('sat'),
    });

    const amountToReceive = amountRequestedInBtc as Money<Currency>;
    const lightningFeeReserve = new Money({
      amount: estimatedFeeSats,
      currency: 'BTC',
      unit: 'sat',
    }) as Money<Currency>;

    const estimatedTotalFee = lightningFeeReserve;
    const estimatedTotalAmount = amountToReceive.add(
      lightningFeeReserve,
    ) as Money<Currency>;

    return {
      paymentRequest,
      amountRequested: amount ?? (amountRequestedInBtc as Money<Currency>),
      amountRequestedInBtc,
      amountToReceive,
      lightningFeeReserve,
      estimatedTotalFee,
      estimatedTotalAmount,
    };
  }

  async payLightningInvoice({
    account,
    quote,
  }: {
    account: SparkAccount;
    quote: SparkLightningQuote;
  }): Promise<SparkSendQuote> {
    const sparkWallet = this.getWallet(account.network);
    if (!sparkWallet) {
      throw new Error(
        `Spark wallet not initialized for network ${account.network}`,
      );
    }
    // TODO: see if actual fee can be greater than the previous estimate
    const maxFeeSats = quote.lightningFeeReserve.toNumber('sat');

    const sendRequest = await sparkWallet.payLightningInvoice({
      // A bug in the Spark SDK requires us to pass the payment request in lowercase.
      // We can remove this once this issue is fixed: https://github.com/buildonspark/spark/issues/75
      invoice: quote.paymentRequest.toLowerCase(),
      maxFeeSats,
      preferSpark: false,
    });

    const isWalletTransferType = isWalletTransfer(sendRequest);
    if (isWalletTransferType) {
      throw new Error(
        'Got WalletTransfer type, but expected LightningSendRequest',
      );
    }
    const createdAt = new Date(sendRequest.createdAt).toISOString();

    return {
      id: sendRequest.id,
      accountId: account.id,
      amountToReceive: quote.amountToReceive,
      paymentRequest: quote.paymentRequest,
      sendRequest,
      state: 'PENDING',
      createdAt,
      lightningFeeReserve: quote.lightningFeeReserve,
      transferId: sendRequest.transfer?.sparkId,
    };
  }

  async getPaymentStatus(
    account: SparkAccount,
    sendRequestId: string,
  ): Promise<SparkSendQuote['state']> {
    const sparkWallet = this.getWallet(account.network);
    if (!sparkWallet) {
      throw new Error(
        `Spark wallet not initialized for network ${account.network}`,
      );
    }

    const status = await sparkWallet.getLightningSendRequest(sendRequestId);
    if (!status) {
      throw new Error('Spark send request not found');
    }

    return this.mapStatusToState(status.status);
  }

  /**
   * Maps Spark SDK status to simplified state.
   */
  mapStatusToState(
    status: LightningSendRequestStatus,
  ): SparkSendQuote['state'] {
    switch (status) {
      case LightningSendRequestStatus.TRANSFER_COMPLETED:
        return 'COMPLETED';
      case LightningSendRequestStatus.LIGHTNING_PAYMENT_FAILED:
        return 'FAILED';
      case LightningSendRequestStatus.CREATED:
      case LightningSendRequestStatus.REQUEST_VALIDATED:
      case LightningSendRequestStatus.LIGHTNING_PAYMENT_INITIATED:
      case LightningSendRequestStatus.LIGHTNING_PAYMENT_SUCCEEDED:
      case LightningSendRequestStatus.PREIMAGE_PROVIDED:
      case LightningSendRequestStatus.FUTURE_VALUE:
        return 'PENDING';
      default:
        throw new Error('Unknown Spark send request status');
    }
  }
}

export function useSparkSendLightningService() {
  const queryClient = useQueryClient();

  return useMemo(
    () =>
      new SparkSendLightningService((network) =>
        getSparkWalletFromCache(queryClient, network),
      ),
    [queryClient],
  );
}
