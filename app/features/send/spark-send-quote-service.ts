import type Big from 'big.js';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import {
  convertUsdbToMoney,
  isInsufficentBalanceError,
  isInvoiceAlreadyPaidError,
} from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import { DomainError } from '../shared/error';
import type { TransactionPurpose } from '../transactions/transaction-enums';
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
   * On USD-source quotes this includes the Flashnet conversion fee.
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send.
   * For BTC-source quotes: amount to receive + lightning fee, in sats.
   * For USD-source quotes: USDB debited from the wallet (in cents).
   */
  estimatedTotalAmount: Money;
  /**
   * Whether the payment request has an amount encoded in the invoice.
   */
  paymentRequestIsAmountless: boolean;
  /**
   * The expiry date of the lightning invoice.
   */
  expiresAt: Date | null;
  /**
   * USDB amount that will be debited from a USD wallet to cover the
   * Lightning send, as estimated by `prepareSendPayment.conversionEstimate`.
   * Set only for USD-source quotes; undefined for BTC.
   */
  usdbDebited?: Money<'USD'>;
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
   * For USD source accounts paying an amountless invoice, this is the user-entered
   * USD amount and is converted to sats via `exchangeRate`.
   */
  amount?: Money;
  /**
   * Required when paying an amountless invoice from a USD source account.
   * Rate is in `USD-BTC` format (multiply USD cents by rate to get sats).
   */
  exchangeRate?: Big | string;
};

type CreateSendQuoteParams = {
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
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer).
   * When not provided, the transaction will be created with PAYMENT purpose.
   */
  purpose?: TransactionPurpose;
  /**
   * UUID linking paired send/receive transactions in a transfer.
   */
  transferId?: string;
};

type InitiateSendParams = {
  /**
   * The Spark account to send from.
   */
  account: SparkAccount;
  /**
   * The send quote to initiate.
   */
  sendQuote: SparkSendQuote;
};

/**
 * Optional fields recorded when the Flashnet USDB → sats conversion completes
 * on a USD-account send. Captured during the conversion-leg `paymentSucceeded`
 * event and persisted alongside the lightning preimage once both legs settle.
 *
 * `Money` fields are typed as the generic `Money` to align with the encrypted
 * blob's `z.instanceof(Money)` schema; sats vs cents is tracked via the
 * underlying `unit`/`currency`.
 */
export type SparkSendCompletionExtras = {
  /** Sats produced by the USDB → sats conversion (input to the lightning leg). */
  satsAfterConversion?: Money;
  /** Fee charged by Flashnet for the USDB → sats swap. */
  conversionFee?: Money;
  /** Actual slippage realised on the conversion. */
  slippageActual?: Money;
};

export class SparkSendQuoteService {
  constructor(private readonly repository: SparkSendQuoteRepository) {}

  /**
   * Estimates the fee for paying a Lightning invoice and returns a quote for the send.
   *
   * For USD-source accounts (Spark USDB), the wallet's `stable_balance_config`
   * causes `prepareSendPayment` to surface a `conversionEstimate` describing how
   * much USDB must be debited to cover the sats Lightning send. The quote then
   * carries `usdbDebited` and folds the conversion fee into `estimatedTotalFee`.
   */
  async getLightningSendQuote({
    account,
    amount,
    paymentRequest,
    exchangeRate,
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
      throw new Error('Unknown send amount');
    }

    const prepareResponse = await measureOperation(
      'BreezSdk.prepareSendPayment',
      () =>
        account.wallet.prepareSendPayment({
          paymentRequest,
          amount: BigInt(amountRequestedInBtc.toNumber('sat')),
        }),
    );

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

    const isUsdAccount = account.currency === 'USD';
    const conversionEstimate = prepareResponse.conversionEstimate;

    if (isUsdAccount && !conversionEstimate) {
      throw new Error(
        'USD send: prepareSendPayment did not return a conversionEstimate',
      );
    }

    const conversionFeeSats = conversionEstimate?.fee ?? 0n;
    const conversionFee = new Money({
      amount: conversionFeeSats.toString(),
      currency: 'BTC',
      unit: 'sat',
    });

    const estimatedTotalFee = isUsdAccount
      ? (estimatedLightningFee.add(conversionFee) as Money)
      : (estimatedLightningFee as Money);

    const usdbDebited =
      isUsdAccount && conversionEstimate
        ? convertUsdbToMoney(conversionEstimate.amountIn)
        : undefined;

    const estimatedTotalAmount = isUsdAccount
      ? // For USD accounts the total spend the user sees is the USDB debited
        // from the wallet — sats fees are already priced into the conversion.
        (usdbDebited as Money)
      : (amountRequestedInBtc.add(estimatedLightningFee) as Money);

    const balance = account.balance ?? Money.zero(account.currency);

    if (balance.lessThan(estimatedTotalAmount)) {
      const estimatedTotalFormatted = isUsdAccount
        ? estimatedTotalAmount.toLocaleString()
        : estimatedTotalAmount.toLocaleString({ unit: 'sat' });
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
      estimatedTotalFee,
      estimatedTotalAmount,
      paymentRequestIsAmountless: invoice.amountMsat === undefined,
      expiresAt,
      usdbDebited,
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
  }: CreateSendQuoteParams): Promise<SparkSendQuote> {
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    const isUsdAccount = account.currency === 'USD';
    const balance = account.balance ?? Money.zero(account.currency);

    if (balance.lessThan(quote.estimatedTotalAmount)) {
      const estimatedTotalFormatted = isUsdAccount
        ? quote.estimatedTotalAmount.toLocaleString()
        : quote.estimatedTotalAmount.toLocaleString({ unit: 'sat' });
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
      usdbDebited: quote.usdbDebited as Money | undefined,
    });
  }

  /**
   * Initiates the lightning payment for an UNPAID quote.
   *
   * @throws InvoiceAlreadyPaidError if the invoice has already been paid (payment was initiated previously).
   * @throws Error if the payment initiation fails for other reasons.
   */
  async initiateSend({
    account,
    sendQuote,
  }: InitiateSendParams): Promise<SparkSendQuote> {
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
      const { payment, lightningSendDetails } = await measureOperation(
        'BreezSdk.sendPayment',
        () =>
          account.wallet.sendPayment({
            prepareResponse,
            idempotencyKey: sendQuote.id,
            options: { type: 'bolt11Invoice', preferSpark: false },
          }),
      );

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
        if (account.currency === 'USD') {
          const balanceFormatted = (
            account.balance ?? Money.zero('USD')
          ).toLocaleString();
          throw new DomainError(
            `Insufficient balance. Available balance is ${balanceFormatted}.`,
          );
        }

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
   * @param extras - Optional conversion-leg fields recorded on USD-account sends
   *   once the USDB → sats conversion has completed.
   * @returns The updated quote.
   * @throws An error if the quote is not in PENDING state.
   */
  async complete(
    quote: SparkSendQuote,
    paymentPreimage: string,
    extras?: SparkSendCompletionExtras,
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
      ...(extras ?? {}),
    });
  }

  /**
   * Fails the spark send quote by marking it as failed.
   * It's a no-op if the quote is already failed.
   * @param quote - The spark send quote to fail.
   * @param reason - The reason for the failure.
   * @throws An error if the quote is not in UNPAID or PENDING state.
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

export function useSparkSendQuoteService() {
  const repository = useSparkSendQuoteRepository();
  return new SparkSendQuoteService(repository);
}
