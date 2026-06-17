import { Money } from '@agicash/money';
import { DomainError, SdkError } from '../../errors';
import { parseBolt11Invoice } from '../../internal/lib/bolt11';
import {
  isInsufficentBalanceError,
  isInvoiceAlreadyPaidError,
} from '../../internal/lib/spark';
import type { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { TransactionPurpose } from '../../types/transaction';

export type SparkLightningQuote = {
  /** The payment request to pay. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** The amount requested. */
  amountRequested: Money;
  /** The amount requested in BTC. */
  amountRequestedInBtc: Money<'BTC'>;
  /** The amount that the receiver will receive. */
  amountToReceive: Money;
  /** The estimated fee. */
  estimatedLightningFee: Money<'BTC'>;
  /** The estimated total fee (lightning fee). */
  estimatedTotalFee: Money;
  /** Estimated total amount of the send (amount to receive + estimated lightning fee). */
  estimatedTotalAmount: Money;
  /** Whether the payment request has an amount encoded in the invoice. */
  paymentRequestIsAmountless: boolean;
  /** The expiry date of the lightning invoice. */
  expiresAt: Date | null;
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
  }: {
    account: SparkAccount;
    paymentRequest: string;
    amount?: Money<'BTC'>;
  }): Promise<SparkLightningQuote> {
    const bolt11ValidationResult = parseBolt11Invoice(paymentRequest);
    if (!bolt11ValidationResult.valid) {
      throw new DomainError('Invalid lightning invoice', 'invalid_invoice');
    }
    const invoice = bolt11ValidationResult.decoded;
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired', 'expired');
    }

    let amountRequestedInBtc = new Money({
      amount: 0,
      currency: 'BTC',
    }) as Money<'BTC'>;

    if (invoice.amountMsat) {
      amountRequestedInBtc = new Money({
        amount: invoice.amountMsat,
        currency: 'BTC',
        unit: 'msat',
      }) as Money<'BTC'>;
    } else if (amount) {
      amountRequestedInBtc = amount;
    } else {
      throw new DomainError(
        'Amount is required for amountless invoices',
        'amount_required',
      );
    }

    const prepareResponse = await account.wallet.prepareSendPayment({
      paymentRequest,
      amount: BigInt(amountRequestedInBtc.toNumber('sat')),
    });

    const paymentMethod = prepareResponse.paymentMethod;
    if (paymentMethod.type !== 'bolt11Invoice') {
      throw new SdkError(
        `Expected bolt11Invoice payment method, got: ${paymentMethod.type}`,
        'spark_unexpected_response',
      );
    }

    // We send with preferSpark: false so the payment is always routed over Lightning.
    // Spark transfer fee does not apply in that case.
    const estimatedLightningFee = new Money({
      amount: paymentMethod.lightningFeeSats,
      currency: 'BTC',
      unit: 'sat',
    }) as Money<'BTC'>;

    const estimatedTotalAmount = amountRequestedInBtc.add(
      estimatedLightningFee,
    ) as Money;

    const balance = account.balance ?? Money.zero(account.currency);

    if (balance.lessThan(estimatedTotalAmount)) {
      const estimatedTotalFormatted = estimatedTotalAmount.toLocaleString({
        unit: 'sat',
      });
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted}.`,
        'insufficient_balance',
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
      expiresAt,
    };
  }

  /**
   * Creates a send quote in UNPAID state.
   * The quote must be initiated with `initiateSend` to start the lightning payment.
   */
  async createSendQuote({
    userId,
    account,
    quote,
    purpose,
    transferId,
  }: {
    userId: string;
    account: SparkAccount;
    quote: SparkLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<SparkSendQuote> {
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired', 'expired');
    }

    const balance = account.balance ?? Money.zero(account.currency);

    if (balance.lessThan(quote.estimatedTotalAmount)) {
      const estimatedTotalFormatted = quote.estimatedTotalAmount.toLocaleString(
        {
          unit: 'sat',
        },
      );
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted}.`,
        'insufficient_balance',
      );
    }

    return this.repository.create({
      userId,
      accountId: account.id,
      amount: quote.amountRequestedInBtc as Money,
      estimatedFee: quote.estimatedLightningFee as Money,
      paymentRequest: quote.paymentRequest,
      paymentHash: quote.paymentHash,
      paymentRequestIsAmountless: quote.paymentRequestIsAmountless,
      expiresAt: quote.expiresAt,
      purpose,
      transferId,
    });
  }

  /**
   * Initiates the lightning payment for an UNPAID quote.
   * This is the executeQuote kickoff primitive: prepareSendPayment → sendPayment → markAsPending → PENDING.
   * `complete()`/`fail()` are invoked by the Breez payment event listener, not by this method.
   *
   * @throws {DomainError} code `already_paid` if the invoice has already been paid.
   * @throws {DomainError} code `insufficient_balance` if the balance is insufficient.
   * @throws {DomainError} code `fee_changed` if the lightning fee changed since quote creation.
   * @throws {DomainError} code `invalid_state` if the quote is not UNPAID or PENDING.
   */
  async initiateSend({
    account,
    sendQuote,
  }: {
    account: SparkAccount;
    sendQuote: SparkSendQuote;
  }): Promise<SparkSendQuote> {
    if (sendQuote.state === 'PENDING') {
      return sendQuote;
    }

    if (sendQuote.state !== 'UNPAID') {
      throw new DomainError(
        `Cannot initiate send for quote that is not UNPAID. Current state: ${sendQuote.state}`,
        'invalid_state',
      );
    }

    const prepareResponse = await account.wallet.prepareSendPayment({
      paymentRequest: sendQuote.paymentRequest,
      amount: BigInt(sendQuote.amount.toNumber('sat')),
    });

    const paymentMethod = prepareResponse.paymentMethod;
    if (paymentMethod.type !== 'bolt11Invoice') {
      throw new SdkError(
        `Expected bolt11Invoice payment method, got: ${paymentMethod.type}`,
        'spark_unexpected_response',
      );
    }

    const estimatedFeeSats = sendQuote.estimatedFee.toNumber('sat');
    if (paymentMethod.lightningFeeSats > estimatedFeeSats) {
      throw new DomainError(
        'Lightning network fee has changed since you confirmed. Please create a new send.',
        'fee_changed',
      );
    }

    try {
      const { payment, lightningSendDetails } =
        await account.wallet.sendPayment({
          prepareResponse,
          idempotencyKey: sendQuote.id,
          options: { type: 'bolt11Invoice', preferSpark: false },
        });

      if (!lightningSendDetails) {
        throw new SdkError(
          'Breez SDK did not return lightningSendDetails for a lightning send',
          'spark_unexpected_response',
        );
      }

      return this.repository.markAsPending({
        quote: sendQuote,
        sparkSendRequestId: lightningSendDetails.sendRequestId,
        sparkTransferId: payment.id,
        fee: new Money({
          amount: Number(payment.fees),
          currency: 'BTC',
          unit: 'sat',
        }) as Money,
      });
    } catch (error) {
      if (isInvoiceAlreadyPaidError(error)) {
        throw new DomainError(
          'Lightning invoice has already been paid.',
          'already_paid',
        );
      }

      if (isInsufficentBalanceError(error)) {
        const totalSats = sendQuote.amount
          .add(sendQuote.estimatedFee)
          .toNumber('sat');
        const availableSats = (
          account.balance ?? Money.zero(account.currency)
        ).toNumber('sat');

        throw new DomainError(
          `Insufficient balance. Total cost of send is ${totalSats} sats but the available balance is ${availableSats} sats.`,
          'insufficient_balance',
        );
      }

      throw error;
    }
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
   * @returns The updated quote.
   * @throws {DomainError} code `invalid_state` if the quote is not in PENDING state.
   */
  async complete(
    quote: SparkSendQuote,
    paymentPreimage: string,
  ): Promise<SparkSendQuote> {
    if (quote.state === 'COMPLETED') {
      return quote;
    }

    if (quote.state !== 'PENDING') {
      throw new DomainError(
        `Cannot complete quote that is not pending. State: ${quote.state}`,
        'invalid_state',
      );
    }

    return this.repository.complete({
      quote,
      paymentPreimage,
    });
  }

  /**
   * Fails the spark send quote by marking it as failed.
   * It's a no-op if the quote is already failed.
   * @param quote - The spark send quote to fail.
   * @param reason - The reason for the failure.
   * @throws {DomainError} code `invalid_state` if the quote is not in UNPAID or PENDING state.
   */
  async fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote> {
    if (quote.state === 'FAILED') {
      return quote;
    }

    if (quote.state !== 'PENDING' && quote.state !== 'UNPAID') {
      throw new DomainError(
        `Cannot fail quote that is not unpaid or pending. State: ${quote.state}`,
        'invalid_state',
      );
    }

    return this.repository.fail(quote.id, reason);
  }
}
