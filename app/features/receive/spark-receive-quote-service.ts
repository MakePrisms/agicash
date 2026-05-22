import type { Money } from '~/lib/money';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  getAmountAndFee,
} from './spark-receive-quote-core';
import {
  type SparkReceiveQuoteRepository,
  useSparkReceiveQuoteRepository,
} from './spark-receive-quote-repository';

type CreateQuoteParams = CreateQuoteBaseParams;

/**
 * Optional fields recorded when the Flashnet sats → USDB conversion completes
 * on a USD-account receive. The lightning leg has already settled by the time
 * these are known; calling `complete` writes them into the encrypted jsonb
 * blob alongside `paymentPreimage` and `sparkTransferId`.
 *
 * `Money` fields are typed as the generic `Money` (not `Money<'BTC'>` etc.) to
 * align with the encrypted-blob schema's `z.instanceof(Money)`. Values are
 * always denominated in sats (`bolt11AmountSats`, `conversionFee`) or cents
 * (`slippageDelta`, `usdbAmountReceived`).
 */
export type SparkReceiveCompletionExtras = {
  /** Sats credited by the lightning leg, before conversion. */
  bolt11AmountSats?: Money;
  /** Fee charged by Flashnet for the sats → USDB swap. */
  conversionFee?: Money;
  /** Difference between estimated and actual USDB output (within slippage). */
  slippageDelta?: Money;
  /** USDB amount actually credited after conversion. */
  usdbAmountReceived?: Money;
};

export class SparkReceiveQuoteService {
  constructor(private readonly repository: SparkReceiveQuoteRepository) {}

  /**
   * Creates a new Spark Lightning receive quote for the given amount.
   * This creates a lightning invoice via Spark and stores the quote in the database.
   */
  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<SparkReceiveQuote> {
    const { userId, account, lightningQuote, purpose, transferId } = params;
    const expiresAt = computeQuoteExpiry(params);
    const { amount, totalFee } = getAmountAndFee(params);

    // For non-BTC accounts (e.g. USD/USDB), persist the BOLT11's sats amount
    // alongside the user-facing `amountToReceive` so the lightning-leg payload
    // is recoverable when the conversion leg completes later. Widened to
    // `Money` (vs `Money<'BTC'>`) to match the encrypted-blob schema's
    // `z.instanceof(Money)`; the cast is the standard pattern in this codebase
    // (see `lightning-address-service.ts:186`).
    const bolt11AmountSats: Money | undefined =
      account.currency === 'BTC'
        ? undefined
        : (lightningQuote.invoice.amount as Money);

    const baseParams = {
      userId,
      accountId: account.id,
      amount,
      paymentRequest: lightningQuote.invoice.paymentRequest,
      paymentHash: lightningQuote.invoice.paymentHash,
      description: lightningQuote.invoice.memo,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
      totalFee,
      bolt11AmountSats,
      purpose,
      transferId,
    };

    if (params.receiveType === 'CASHU_TOKEN') {
      return this.repository.create({
        ...baseParams,
        receiveType: 'CASHU_TOKEN',
        meltData: {
          tokenMintUrl: params.sourceMintUrl,
          tokenAmount: params.tokenAmount,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
          cashuReceiveFee: params.cashuReceiveFee,
          lightningFeeReserve: params.lightningFeeReserve,
        },
      });
    }

    return this.repository.create({
      ...baseParams,
      receiveType: 'LIGHTNING',
    });
  }

  /**
   * Gets a Spark receive quote by ID.
   * @param quoteId - The ID of the quote.
   * @returns The quote or null if not found.
   */
  async get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.repository.get(quoteId);
  }

  /**
   * Completes the spark receive quote by marking it as paid.
   * It's a no-op if the quote is already paid.
   * @param quote - The spark receive quote to complete.
   * @param paymentPreimage - The payment preimage from the lightning payment.
   * @param sparkTransferId - The Spark transfer ID from the completed transfer.
   * @param extras - Optional conversion-leg fields recorded on USD-account
   *   receives once the sats → USDB conversion completes.
   * @returns The updated quote.
   * @throws An error if the quote is not in UNPAID state.
   */
  async complete(
    quote: SparkReceiveQuote,
    paymentPreimage: string,
    sparkTransferId: string,
    extras?: SparkReceiveCompletionExtras,
  ): Promise<SparkReceiveQuote> {
    if (quote.state === 'PAID') {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot complete quote that is not unpaid. State: ${quote.state}`,
      );
    }

    return this.repository.complete({
      quote,
      paymentPreimage,
      sparkTransferId,
      ...(extras ?? {}),
    });
  }

  /**
   * Expires the spark receive quote by marking it as expired.
   * It's a no-op if the quote is already expired.
   * @param quote - The spark receive quote to expire.
   * @throws An error if the quote is not in UNPAID state or has not expired yet.
   */
  async expire(quote: SparkReceiveQuote): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot expire quote that is not unpaid. State: ${quote.state}`,
      );
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }

    await this.repository.expire(quote.id);
  }

  /**
   * Fails the spark receive quote by marking it as failed.
   * It's a no-op if the quote is already failed.
   * @param quote - The spark receive quote to fail.
   * @param reason - The reason for the failure.
   * @throws An error if the quote is not in UNPAID state.
   */
  async fail(quote: SparkReceiveQuote, reason: string): Promise<void> {
    if (quote.state === 'FAILED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot fail quote that is not unpaid. State: ${quote.state}`,
      );
    }

    await this.repository.fail({ id: quote.id, reason });
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
   * It's a no-op if the melt was already marked as initiated.
   * @param quote - The spark receive quote of type CASHU_TOKEN.
   * @returns The updated quote.
   * @throws An error if the quote is not of type TOKEN or is not in UNPAID state.
   */
  async markMeltInitiated(
    quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }> {
    if (quote.type !== 'CASHU_TOKEN') {
      throw new Error('Invalid quote type. Quote must be of type CASHU_TOKEN.');
    }

    if (quote.tokenReceiveData.meltInitiated) {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Invalid quote state. Quote must be in UNPAID state. State: ${quote.state}`,
      );
    }

    return this.repository.markMeltInitiated(quote);
  }
}

export function useSparkReceiveQuoteService() {
  const repository = useSparkReceiveQuoteRepository();
  return new SparkReceiveQuoteService(repository);
}
