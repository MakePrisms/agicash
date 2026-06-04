/**
 * Spark lightning-RECEIVE SERVICE — Slice 3 / PR5c. The idempotent primitives for a
 * `SparkReceiveQuote`'s lifecycle.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/spark-receive-quote-service.ts`. Master's
 * `SparkReceiveQuoteService` is a plain class (only the `useSparkReceiveQuoteService()` factory
 * couples it to React); lifted near-verbatim, taking the SDK {@link SparkReceiveQuoteRepository}.
 * The invoice-creation primitive ({@link getLightningQuote}, Breez `receivePayment`) lives in
 * `spark-receive-quote-core.ts` and is exposed here as a thin passthrough so the public
 * `createLightningQuote` kickoff can do `getLightningQuote` + `createReceiveQuote` in one place
 * (mirroring the cashu receive service). Master calls the core `getLightningQuote` directly from
 * its receive hook; the SDK folds it onto the service so the domain method stays declarative.
 *
 * The completion path (`complete`, marking PAID off the Breez transfer) is what the (future)
 * `executeQuote` orchestrator drives; `createLightningQuote` is the user-invoked kickoff.
 *
 * @module
 */
import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkReceiveQuote } from '../types/spark';

/** Idempotent service primitives for a spark lightning-receive quote. */
export class SparkReceiveQuoteService {
  constructor(private readonly repository: SparkReceiveQuoteRepository) {}

  /**
   * Create a Breez SDK lightning receive quote (the invoice to receive over) via the account's
   * live Breez wallet. Thin passthrough to the core {@link getLightningQuote}.
   *
   * @param params - the live wallet, amount, and optional receiver pubkey / description.
   * @returns the Spark lightning receive quote.
   */
  async getLightningQuote(
    params: GetLightningQuoteParams,
  ): Promise<SparkReceiveLightningQuote> {
    return getLightningQuote(params);
  }

  /**
   * Create (persist) a new Spark Lightning receive quote for the given amount from a lightning
   * quote. Master verbatim.
   *
   * @returns the created {@link SparkReceiveQuote} (UNPAID).
   */
  async createReceiveQuote(
    params: CreateQuoteBaseParams,
  ): Promise<SparkReceiveQuote> {
    const { userId, account, lightningQuote, purpose, transferId } = params;
    const expiresAt = computeQuoteExpiry(params);
    const { amount, totalFee } = getAmountAndFee(params);

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
   * Get a spark receive quote by id, or null. Master verbatim.
   *
   * @param quoteId - the quote id.
   */
  async get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.repository.get(quoteId);
  }

  /**
   * Complete the spark receive quote (mark PAID). No-op if already PAID. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID.
   */
  async complete(
    quote: SparkReceiveQuote,
    paymentPreimage: string,
    sparkTransferId: string,
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
    });
  }

  /**
   * Expire the spark receive quote (mark EXPIRED). No-op if already EXPIRED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID or has not expired yet.
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
   * Fail the spark receive quote (mark FAILED). No-op if already FAILED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID.
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
   * Mark the melt initiated for a CASHU_TOKEN spark receive quote. No-op if already initiated.
   * Master verbatim.
   *
   * @throws Error if the quote is not CASHU_TOKEN or is not UNPAID.
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
