import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import type { SdkEventEmitter } from '../event-emitter';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';

type CashuTokenSparkReceiveQuote = SparkReceiveQuote & { type: 'CASHU_TOKEN' };

export type SparkReceiveOrchestratorDeps = {
  receiveQuoteService: SparkReceiveQuoteService;
  getAccount: (accountId: string) => Promise<SparkAccount | null>;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives spark receives. Lightning receives complete on Breez `paymentSucceeded`
 * (matched by HTLC `paymentHash`); expiry is detected via the `synced` event sweep.
 * The CASHU_TOKEN cross-mint sub-flow melts the source-mint proofs (cashu melt-quote
 * WS via the reused MeltQuoteSubscriptionManager) and marks/fails the spark quote.
 * Subscription lifecycle + poll cadence are S9's job.
 */
export class SparkReceiveOrchestrator {
  constructor(private readonly deps: SparkReceiveOrchestratorDeps) {}

  async applyPaymentSucceeded(
    quote: SparkReceiveQuote,
    payment: Payment,
  ): Promise<void> {
    const details = payment.details;
    if (details?.type !== 'lightning') return;
    const preimage = details.htlcDetails.preimage;
    if (!preimage) {
      console.error('spark receive payment succeeded but no preimage', {
        paymentId: payment.id,
        quoteId: quote.id,
      });
      return;
    }
    const completed = await this.deps.receiveQuoteService.complete(
      quote,
      preimage,
      payment.id,
    );
    if (completed.state === 'PAID') {
      this.deps.emitter.emit('receive:completed', {
        quoteId: completed.id,
        transactionId: completed.transactionId,
        amount: completed.amount,
        protocol: 'spark',
      });
    }
  }

  async applyExpiry(quote: SparkReceiveQuote): Promise<void> {
    if (quote.state !== 'UNPAID') return;
    if (new Date(quote.expiresAt) >= new Date()) return;
    await this.deps.receiveQuoteService.expire(quote);
    this.deps.emitter.emit('receive:expired', {
      quoteId: quote.id,
      protocol: 'spark',
    });
  }
}
