import type { SparkWallet } from '@buildonspark/spark-sdk';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import type { SparkAccount } from '../accounts/account';
import { DomainError } from '../shared/error';
import type { SparkSendQuote } from './spark-send-quote';
import {
  type SparkSendQuoteRepository,
  useSparkSendQuoteRepository,
} from './spark-send-quote-repository';

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
};

type GetSparkSendQuoteOptions = {
  /**
   * The Spark account to get a quote for.
   */
  account: SparkAccount;
  /**
   * The payment request to get a quote for.
   */
  paymentRequest: string;
  /**
   * Amount to send. Required for zero-amount invoices. If the invoice has an amount, this will be ignored.
   */
  amount?: Money<'BTC'>;
};

type InitiateSendParams = {
  /**
   * The user ID.
   */
  userId: string;
  /**
   * The Spark account to send from.
   */
  account: SparkAccount;
  /**
   * The fee estimate returned by getLightningSendQuote.
   */
  quote: SparkLightningQuote;
};

export class SparkSendQuoteService {
  constructor(private readonly repository: SparkSendQuoteRepository) {}

  /**
   * Estimates the fee for paying a Lightning invoice and returns a quote for the send.
   */
  async getLightningSendQuote({
    account,
    amount,
    paymentRequest,
  }: GetSparkSendQuoteOptions): Promise<SparkLightningQuote> {
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

    const wallet = this.getSparkWalletOrThrow(account);
    const estimatedLightningFeeSats = await wallet.getLightningSendFeeEstimate({
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
    ) as Money;

    if (!account.balance || account.balance.lessThan(estimatedTotalAmount)) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalAmount.toLocaleString({ unit: 'sat' })}.`,
      );
    }

    return {
      paymentRequest,
      paymentHash: invoice.paymentHash,
      amountRequested: amountRequestedInBtc as Money,
      amountRequestedInBtc,
      amountToReceive: amountRequestedInBtc as Money,
      estimatedLightningFee,
      estimatedTotalFee: estimatedLightningFee as Money,
      estimatedTotalAmount,
      paymentRequestIsAmountless: invoice.amountMsat === undefined,
    };
  }

  /**
   * Initiates a Lightning payment and stores the quote in the database.
   * @throws Error if the payment initiation fails
   */
  async initiateSend({
    userId,
    account,
    quote,
  }: InitiateSendParams): Promise<SparkSendQuote> {
    const wallet = this.getSparkWalletOrThrow(account);

    const request = await wallet.payLightningInvoice({
      invoice: quote.paymentRequest,
      maxFeeSats: quote.estimatedLightningFee.toNumber('sat'),
      preferSpark: false,
      amountSatsToSend: quote.paymentRequestIsAmountless
        ? quote.amountRequestedInBtc.toNumber('sat')
        : undefined,
    });

    // Type guard to ensure we have a LightningSendRequest
    if (!('encodedInvoice' in request)) {
      throw new Error(
        'Expected a LightningSendRequest, but got a different type',
      );
    }

    const sendQuote = await this.repository.create({
      userId,
      accountId: account.id,
      amount: quote.amountRequestedInBtc as Money,
      fee: quote.estimatedLightningFee as Money,
      paymentRequest: quote.paymentRequest,
      paymentHash: quote.paymentHash,
      sparkRequestId: request.id,
    });

    return sendQuote;
  }

  /**
   * Gets a Spark send quote by ID from the database.
   * @param quoteId - The ID of the quote.
   * @returns The quote or null if not found.
   */
  async get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.repository.get(quoteId);
  }

  /**
   * Completes the spark send quote by marking it as completed.
   * It's a no-op if the quote is already completed.
   * @param quote - The spark send quote to complete.
   * @param paymentPreimage - The payment preimage from the lightning payment.
   * @param sparkTransferId - The Spark transfer ID from the completed transfer.
   * @param fee - The actual fee paid for the lightning payment.
   * @returns The updated quote.
   * @throws An error if the quote is not in PENDING state.
   */
  async complete(
    quote: SparkSendQuote,
    paymentPreimage: string,
    sparkTransferId: string,
    fee: Money,
  ): Promise<SparkSendQuote> {
    if (quote.state === 'COMPLETED') {
      return quote;
    }

    if (quote.state !== 'PENDING') {
      throw new Error(
        `Cannot complete quote that is not pending. State: ${quote.state}`,
      );
    }

    return this.repository.complete({
      quote,
      paymentPreimage,
      sparkTransferId,
      fee,
    });
  }

  /**
   * Fails the spark send quote by marking it as failed.
   * It's a no-op if the quote is already failed.
   * @param quote - The spark send quote to fail.
   * @param reason - The reason for the failure.
   * @throws An error if the quote is not in PENDING state.
   */
  async fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote> {
    if (quote.state === 'FAILED') {
      return quote;
    }

    if (quote.state !== 'PENDING') {
      throw new Error(
        `Cannot fail quote that is not pending. State: ${quote.state}`,
      );
    }

    return this.repository.fail(quote.id, reason);
  }

  private getSparkWalletOrThrow(account: SparkAccount): SparkWallet {
    if (!account.wallet) {
      throw new Error(`Spark account ${account.id} has no wallet`);
    }
    return account.wallet;
  }
}

export function useSparkSendQuoteService() {
  const repository = useSparkSendQuoteRepository();
  return new SparkSendQuoteService(repository);
}
