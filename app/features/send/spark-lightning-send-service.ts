import type { SparkWallet } from '@buildonspark/spark-sdk';
import {
  type LightningSendRequest,
  LightningSendRequestStatus,
  type WalletTransfer,
} from '@buildonspark/spark-sdk/types';
import { decodeBolt11, parseBolt11Invoice } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import { DomainError, NotFoundError } from '../shared/error';
import { useSparkWallet } from '../shared/spark';

export type SparkLightningSend = {
  id: string;
  createdAt: string;
  paymentRequest: string;
  preimage?: string;
  updatedAt: string;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  amount: Money;
  fee: Money;
};

export type SparkLightningSendQuote = {
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
};

type GetSparkLightningSendQuoteOptions = {
  /**
   * The payment request to get a quote for.
   */
  paymentRequest: string;
  /**
   * Amount to send. Required for zero-amount invoices. If the invoice has an amount, this will be ignored.
   */
  amount?: Money<'BTC'>;
};

type CreateSparkLightningSendParams = {
  /**
   * The fee estimate returned by estimateFee.
   */
  quote: SparkLightningSendQuote;
};

const isLightningSendRequest = (
  request: LightningSendRequest | WalletTransfer,
): request is LightningSendRequest => {
  return 'encodedInvoice' in request;
};

export class SparkLightningSendService {
  constructor(private readonly sparkWallet: SparkWallet) {}

  /**
   * Estimates the fee for paying a Lightning invoice and returns a quote for the send.
   */
  async getLightningSendQuote({
    paymentRequest,
    amount,
  }: GetSparkLightningSendQuoteOptions): Promise<SparkLightningSendQuote> {
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
      amountRequestedInBtc = amount;
    } else {
      throw new Error('Unknown send amount');
    }

    const estimatedLightningFeeSats =
      await this.sparkWallet.getLightningSendFeeEstimate({
        amountSats: amountRequestedInBtc.toNumber('sat'),
        encodedInvoice: paymentRequest,
      });

    const estimatedLightningFee = new Money({
      amount: estimatedLightningFeeSats,
      currency: 'BTC',
      unit: 'sat',
    });

    const estimatedTotalAmount = amountRequestedInBtc.add(
      estimatedLightningFee,
    );

    const { balance: currenctBalanceSats } =
      await this.sparkWallet.getBalance();
    const currentBalance = new Money({
      amount: Number(currenctBalanceSats),
      currency: 'BTC',
      unit: 'sat',
    });

    if (currentBalance.lessThan(estimatedTotalAmount)) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalAmount.toLocaleString({ unit: 'sat' })}.`,
      );
    }

    return {
      paymentRequest,
      amountRequested: amountRequestedInBtc as Money,
      amountRequestedInBtc,
      amountToReceive: amountRequestedInBtc as Money,
      estimatedLightningFee,
      estimatedTotalFee: estimatedLightningFee as Money,
      estimatedTotalAmount: estimatedTotalAmount as Money,
      paymentRequestIsAmountless: invoice.amountMsat === undefined,
    };
  }

  /**
   * Pays a Lightning invoice.
   * @throws Error if the payment fails or if the fee exceeds maxFeeSats
   */
  async initiateSend({
    quote,
  }: CreateSparkLightningSendParams): Promise<SparkLightningSend> {
    const request = await this.sparkWallet.payLightningInvoice({
      invoice: quote.paymentRequest,
      maxFeeSats: quote.estimatedLightningFee.toNumber('sat'),
      preferSpark: true,
      amountSatsToSend: quote.paymentRequestIsAmountless
        ? quote.amountRequestedInBtc.toNumber('sat')
        : undefined,
    });

    return this.toSparkLightningSend(request, quote.amountRequestedInBtc);
  }

  /**
   * Gets a Spark Lightning Send Request by ID.
   * @param requestId - The ID of the Spark Lightning Send Request
   * @throws Error if the request is not found
   */
  async get(requestId: string): Promise<SparkLightningSend> {
    let request: LightningSendRequest | WalletTransfer | null | undefined;
    if (requestId.startsWith('SparkLightningSendRequest')) {
      request = await this.sparkWallet.getLightningSendRequest(requestId);
    } else {
      request = await this.sparkWallet.getTransfer(requestId);
    }
    if (!request) {
      throw new NotFoundError(`Spark send request ${requestId} not found`);
    }
    return this.toSparkLightningSend(request);
  }

  private toSparkLightningSend(
    request: LightningSendRequest | WalletTransfer,
    amountRequestedInBtc?: Money<'BTC'>,
  ): SparkLightningSend {
    const state = SparkLightningSendService.toState(request);

    if (isLightningSendRequest(request)) {
      const decoded = decodeBolt11(request.encodedInvoice);
      const amount = decoded.amountSat
        ? new Money({
            amount: decoded.amountSat,
            currency: 'BTC' as const,
            unit: 'sat' as const,
          })
        : undefined;
      const fee = moneyFromSparkAmount(request.fee);

      return {
        id: request.id,
        createdAt: request.createdAt,
        paymentRequest: request.encodedInvoice,
        preimage: request.paymentPreimage,
        updatedAt: request.updatedAt,
        state,
        // TODO: How to handle amountless invoices?
        amount: (amount ?? amountRequestedInBtc ?? Money.zero('BTC')) as Money,
        fee: fee,
      };
    }
    const amount = new Money({
      amount: request.totalValue,
      currency: 'BTC',
      unit: 'sat',
    });

    // Todo: we should modify the return type to be specific to wallet transfers, but this is just to see how it works.
    return {
      id: request.id,
      createdAt: request.createdTime?.toISOString() ?? new Date().toISOString(),
      paymentRequest: request.receiverIdentityPublicKey,
      preimage: undefined,
      updatedAt: request.updatedTime?.toISOString() ?? new Date().toISOString(),
      state,
      amount: amount as Money,
      fee: Money.zero('BTC'),
    };
  }

  /**
   * Maps a Spark Lightning Send Request status to a simplified state.
   */
  private static toState(
    request: LightningSendRequest | WalletTransfer,
  ): SparkLightningSend['state'] {
    if (isLightningSendRequest(request)) {
      switch (request.status) {
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

    // WalletTransfer status mapping (spark SDK defines an enum that is not exported)
    switch (request.status) {
      case 'TRANSFER_STATUS_COMPLETED':
      case 'TRANSFER_STATUS_RETURNED':
        return 'COMPLETED';
      case 'TRANSFER_STATUS_EXPIRED':
        return 'FAILED';
      case 'TRANSFER_STATUS_SENDER_INITIATED':
      case 'TRANSFER_STATUS_SENDER_KEY_TWEAK_PENDING':
      case 'TRANSFER_STATUS_SENDER_KEY_TWEAKED':
      case 'TRANSFER_STATUS_RECEIVER_KEY_TWEAKED':
      case 'TRANSFER_STATUS_RECEIVER_REFUND_SIGNED':
      case 'TRANSFER_STATUS_SENDER_INITIATED_COORDINATOR':
      case 'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_LOCKED':
      case 'TRANSFER_STATUS_RECEIVER_KEY_TWEAK_APPLIED':
        return 'PENDING';
      default:
        throw new Error('Unknown Spark transfer status');
    }
  }
}

export function useSparkLightningSendService() {
  const sparkWallet = useSparkWallet();
  return new SparkLightningSendService(sparkWallet);
}
