/**
 * Spark lightning-send SERVICE — Slice 3 / PR5c. The idempotent service primitives for a
 * `SparkSendQuote`'s lifecycle.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/spark-send-quote-service.ts`. Master's `SparkSendQuoteService`
 * is ALREADY a plain class (only the `useSparkSendQuoteService()` factory couples it to React);
 * here it is lifted near-verbatim, dropping the factory and taking the SDK
 * {@link SparkSendQuoteRepository}. The Breez operations (`prepareSendPayment` / `sendPayment`)
 * run against the account's LIVE `BreezSdk` handle (PR5a). `initiateSend`'s `sendPayment` is the
 * idempotency keystone — it passes `idempotencyKey: sendQuote.id`, so a re-issued send for the
 * same quote does not double-pay (Breez surfaces the already-paid invoice, which is caught and
 * surfaced as a {@link DomainError}).
 *
 * Re-housing vs master:
 *  - `parseBolt11Invoice` comes from `./lib-scan`; the Breez error classifiers
 *    (`isInsufficentBalanceError` / `isInvoiceAlreadyPaidError`) from `./lib-spark` (the specific
 *    `lib/spark/errors` module — NOT the barrel, which would pull the native WASM, see lib-spark);
 *  - `measureOperation` telemetry around the Breez calls is dropped (§3 — same as `spark-wallet.ts`).
 *
 * The state machine that SEQUENCES these primitives (UNPAID → PENDING → COMPLETED/FAILED, where
 * the terminal transition is driven by the Breez `paymentSucceeded` / `paymentFailed` event
 * callback) is the `executeQuote` ORCHESTRATOR — DEFERRED to the orchestrator sub-slice (PR5d),
 * the same place cashu's `executeQuote` lands (see `domains/spark.ts`). These methods are the
 * steps it calls.
 *
 * @module
 */
import { parseBolt11Invoice } from './lib-scan';
import {
  isInsufficentBalanceError,
  isInvoiceAlreadyPaidError,
} from './lib-spark';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import { DomainError } from '../errors';
import type { SparkAccount } from '../types/account';
import { Money } from '../types/money';
import type { SparkSendQuote } from '../types/spark';

/** The computed spark lightning quote returned before the send is persisted (master verbatim). */
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
  /** The estimated lightning fee. */
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

/** Options for {@link SparkSendQuoteService.getLightningSendQuote} (master verbatim). */
export type GetSparkSendQuoteOptions = {
  /** The Spark account to get a quote for (its live wallet is used). */
  account: SparkAccount;
  /** The payment request to get a quote for. */
  paymentRequest: string;
  /** Amount to send. Required for zero-amount invoices; ignored if the invoice has an amount. */
  amount?: Money<'BTC'>;
};

/** Params for {@link SparkSendQuoteService.createSendQuote} (master verbatim). */
export type CreateSparkSendQuoteParams = {
  /** The user ID. */
  userId: string;
  /** The Spark account to send from. */
  account: SparkAccount;
  /** The fee estimate returned by {@link SparkSendQuoteService.getLightningSendQuote}. */
  quote: SparkLightningQuote;
  /** The purpose of this transaction (e.g. a Cash App buy or an internal transfer). */
  purpose?: string;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

/** Params for {@link SparkSendQuoteService.initiateSend} (master verbatim). */
export type InitiateSparkSendParams = {
  /** The Spark account to send from. */
  account: SparkAccount;
  /** The send quote to initiate. */
  sendQuote: SparkSendQuote;
};

/** Idempotent service primitives for a spark lightning-send quote. */
export class SparkSendQuoteService {
  constructor(private readonly repository: SparkSendQuoteRepository) {}

  /**
   * Estimate the fee for paying a Lightning invoice and return a quote for the send. Calls the
   * account's live Breez wallet `prepareSendPayment` (routed over Lightning, `preferSpark:
   * false`, so the Spark transfer fee does not apply). Master verbatim.
   *
   * @throws DomainError if the invoice is invalid / expired or the balance is insufficient.
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
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    let amountRequestedInBtc = new Money({ amount: 0, currency: 'BTC' });

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

    const prepareResponse = await account.wallet.prepareSendPayment({
      paymentRequest,
      amount: BigInt(amountRequestedInBtc.toNumber('sat')),
    });

    const paymentMethod = prepareResponse.paymentMethod;
    if (paymentMethod.type !== 'bolt11Invoice') {
      throw new Error(
        `Expected bolt11Invoice payment method, got: ${paymentMethod.type}`,
      );
    }

    // We send with preferSpark: false so the payment is always routed over Lightning.
    // Spark transfer fee does not apply in that case.
    const estimatedLightningFee = new Money({
      amount: paymentMethod.lightningFeeSats,
      currency: 'BTC',
      unit: 'sat',
    });

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
   * Create a send quote in UNPAID state. The quote must be initiated with {@link initiateSend}
   * to start the lightning payment. Master verbatim.
   *
   * @throws DomainError if the invoice has expired or the balance is insufficient.
   */
  async createSendQuote({
    userId,
    account,
    quote,
    purpose,
    transferId,
  }: CreateSparkSendQuoteParams): Promise<SparkSendQuote> {
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    const balance = account.balance ?? Money.zero(account.currency);

    if (balance.lessThan(quote.estimatedTotalAmount)) {
      const estimatedTotalFormatted = quote.estimatedTotalAmount.toLocaleString(
        { unit: 'sat' },
      );
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted}.`,
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
   * Initiate the lightning payment for an UNPAID quote via the account's live Breez wallet.
   * No-op if already PENDING. The `idempotencyKey: sendQuote.id` makes a re-issued send safe.
   * Master verbatim.
   *
   * @throws DomainError if the invoice was already paid, the balance is insufficient, or the fee
   *   changed since confirmation; Error if the quote is not UNPAID/PENDING.
   */
  async initiateSend({
    account,
    sendQuote,
  }: InitiateSparkSendParams): Promise<SparkSendQuote> {
    if (sendQuote.state === 'PENDING') {
      return sendQuote;
    }

    if (sendQuote.state !== 'UNPAID') {
      throw new Error(
        `Cannot initiate send for quote that is not UNPAID. Current state: ${sendQuote.state}`,
      );
    }

    const prepareResponse = await account.wallet.prepareSendPayment({
      paymentRequest: sendQuote.paymentRequest,
      amount: BigInt(sendQuote.amount.toNumber('sat')),
    });

    const paymentMethod = prepareResponse.paymentMethod;
    if (paymentMethod.type !== 'bolt11Invoice') {
      throw new Error(
        `Expected bolt11Invoice payment method, got: ${paymentMethod.type}`,
      );
    }

    const estimatedFeeSats = sendQuote.estimatedFee.toNumber('sat');
    if (paymentMethod.lightningFeeSats > estimatedFeeSats) {
      throw new DomainError(
        'Lightning network fee has changed since you confirmed. Please create a new send.',
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
        throw new Error(
          'Breez SDK did not return lightningSendDetails for a lightning send',
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
        throw new DomainError('Lightning invoice has already been paid.');
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
        );
      }

      throw error;
    }
  }

  /**
   * Get a spark send quote by id, or null. Master verbatim.
   *
   * @param quoteId - the quote id.
   */
  async get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.repository.get(quoteId);
  }

  /**
   * Complete the spark send quote (mark COMPLETED). No-op if already COMPLETED. Master verbatim.
   *
   * @throws Error if the quote is not PENDING.
   */
  async complete(
    quote: SparkSendQuote,
    paymentPreimage: string,
  ): Promise<SparkSendQuote> {
    if (quote.state === 'COMPLETED') {
      return quote;
    }

    if (quote.state !== 'PENDING') {
      throw new Error(
        `Cannot complete quote that is not pending. State: ${quote.state}`,
      );
    }

    return this.repository.complete({ quote, paymentPreimage });
  }

  /**
   * Fail the spark send quote (mark FAILED). No-op if already FAILED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID or PENDING.
   */
  async fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote> {
    if (quote.state === 'FAILED') {
      return quote;
    }

    if (quote.state !== 'PENDING' && quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot fail quote that is not unpaid or pending. State: ${quote.state}`,
      );
    }

    return this.repository.fail(quote.id, reason);
  }
}
