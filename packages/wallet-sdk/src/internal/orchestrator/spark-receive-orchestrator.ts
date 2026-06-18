import type { Payment } from '@agicash/breez-sdk-spark';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
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

  async reconcile(receiveQuotes: SparkReceiveQuote[]): Promise<() => void> {
    const pending = receiveQuotes.filter((q) => q.state === 'UNPAID');
    if (pending.length === 0) return () => undefined;
    const triggered = new Set<string>();
    const cleanups: Array<() => void> = [];

    const byAccount = new Map<string, SparkReceiveQuote[]>();
    for (const quote of pending) {
      const list = byAccount.get(quote.accountId) ?? [];
      list.push(quote);
      byAccount.set(quote.accountId, list);
    }

    for (const [accountId, quotes] of byAccount) {
      const account = await this.deps.getAccount(accountId);
      if (!account) continue;
      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));

      const handleSucceeded = (payment: Payment) => {
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        const quote = quoteByPaymentHash.get(details.htlcDetails.paymentHash);
        if (!quote) return;
        const key = `${quote.id}:completed`;
        if (triggered.has(key)) return;
        triggered.add(key);
        void this.applyPaymentSucceeded(quote, payment).catch((error) =>
          console.error('spark receive payment event failed', {
            quoteId: quote.id,
            cause: error,
          }),
        );
      };

      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event) => {
          if (event.type === 'paymentSucceeded') {
            handleSucceeded(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              const key = `${quote.id}:expired`;
              if (triggered.has(key)) continue;
              if (new Date(quote.expiresAt) >= new Date()) continue;
              triggered.add(key);
              void this.applyExpiry(quote).catch((error) =>
                console.error('spark receive expiry failed', {
                  quoteId: quote.id,
                  cause: error,
                }),
              );
            }
          }
        },
      });
      cleanups.push(() => {
        void listenerPromise
          .then((id) => account.wallet.removeEventListener(id))
          .catch(() =>
            console.warn('Failed to remove Spark receive listener', {
              accountId,
            }),
          );
      });

      for (const quote of quotes) {
        void account.wallet
          .getPaymentByInvoice({ invoice: quote.paymentRequest })
          .then((response) => {
            if (response.payment && response.payment.status === 'completed') {
              handleSucceeded(response.payment);
            }
          })
          .catch((error) =>
            console.error('spark receive initial status check failed', {
              quoteId: quote.id,
              cause: error,
            }),
          );
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }

  async applyCrossMintMeltState(
    quote: CashuTokenSparkReceiveQuote,
    meltQuote: MeltQuoteBolt11Response,
    handlers: {
      initiateMelt: (quote: CashuTokenSparkReceiveQuote) => Promise<void>;
    },
  ): Promise<void> {
    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (quote.tokenReceiveData.meltInitiated) {
        await this.deps.receiveQuoteService.fail(
          quote,
          'Cashu token melt failed.',
        );
        this.deps.emitter.emit('receive:failed', {
          quoteId: quote.id,
          error: new SdkError(
            'Cashu token melt failed.',
            'spark_token_melt_failed',
          ),
          protocol: 'spark',
        });
      } else {
        await handlers.initiateMelt(quote);
      }
      return;
    }
    if (meltQuote.state === MeltQuoteState.PENDING) {
      await this.deps.receiveQuoteService.markMeltInitiated(quote);
    }
  }

  async reconcileCrossMintMelts(
    receiveQuotes: SparkReceiveQuote[],
    handlers: {
      initiateMelt: (quote: CashuTokenSparkReceiveQuote) => Promise<void>;
    },
  ): Promise<void> {
    const tokenQuotes = receiveQuotes.filter(
      (q): q is CashuTokenSparkReceiveQuote =>
        q.type === 'CASHU_TOKEN' && q.state === 'UNPAID',
    );
    if (tokenQuotes.length === 0) return;
    const triggered = new Set<string>();
    const byMeltQuoteId = new Map<string, CashuTokenSparkReceiveQuote>();
    const idsByMint = new Map<string, string[]>();
    for (const quote of tokenQuotes) {
      const mintUrl = quote.tokenReceiveData.sourceMintUrl;
      const meltQuoteId = quote.tokenReceiveData.meltQuoteId;
      byMeltQuoteId.set(meltQuoteId, quote);
      const list = idsByMint.get(mintUrl) ?? [];
      list.push(meltQuoteId);
      idsByMint.set(mintUrl, list);
    }
    for (const [mintUrl, quoteIds] of idsByMint) {
      await this.deps.meltSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (meltQuote) => {
          const quote = byMeltQuoteId.get(meltQuote.quote);
          if (!quote) return;
          const key = `${quote.id}:${meltQuote.state}`;
          if (triggered.has(key)) return;
          triggered.add(key);
          void this.applyCrossMintMeltState(quote, meltQuote, handlers).catch(
            (error) =>
              console.error('spark receive cross-mint melt update failed', {
                quoteId: quote.id,
                cause: error,
              }),
          );
        },
      });
    }
  }
}
