import type { CashuTokenMeltData } from '../../types/cashu';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
  CashuReceiveSwap,
} from '../../types/cashu';
import type { SparkReceiveQuote, SparkSendQuote } from '../../types/spark';
import type { SdkEventMap } from '../../events';
import type { SdkEventEmitter } from '../event-emitter';

export type InitiateMelt = (quote: {
  tokenReceiveData: CashuTokenMeltData;
}) => Promise<void>;

export type TaskLoopDeps = {
  repos: {
    cashuSendQuote: {
      getUnresolved(userId: string): Promise<CashuSendQuote[]>;
    };
    cashuSendSwap: { getUnresolved(userId: string): Promise<CashuSendSwap[]> };
    cashuReceiveQuote: {
      getPending(userId: string): Promise<CashuReceiveQuote[]>;
    };
    cashuReceiveSwap: {
      getPending(userId: string): Promise<CashuReceiveSwap[]>;
    };
    sparkSendQuote: {
      getUnresolved(userId: string): Promise<SparkSendQuote[]>;
    };
    sparkReceiveQuote: {
      getPending(userId: string): Promise<SparkReceiveQuote[]>;
    };
  };
  orchestrators: {
    cashuSend: { reconcile(quotes: CashuSendQuote[]): Promise<void> };
    cashuSendSwap: {
      processDrafts(swaps: CashuSendSwap[]): Promise<void>;
      reconcile(pending: CashuSendSwap[]): Promise<void>;
    };
    cashuReceiveQuote: {
      reconcileMintQuotes(quotes: CashuReceiveQuote[]): Promise<void>;
      reconcileCrossMintMelts(
        quotes: (CashuReceiveQuote & { type: 'CASHU_TOKEN' })[],
        handlers: { initiateMelt: InitiateMelt },
      ): Promise<void>;
    };
    cashuReceiveSwap: {
      processPending(swaps: CashuReceiveSwap[]): Promise<void>;
    };
    sparkSend: { reconcile(quotes: SparkSendQuote[]): Promise<() => void> };
    sparkReceive: {
      reconcile(quotes: SparkReceiveQuote[]): Promise<() => void>;
      reconcileCrossMintMelts(
        quotes: SparkReceiveQuote[],
        handlers: { initiateMelt: InitiateMelt },
      ): Promise<void>;
      applyExpiry(quote: SparkReceiveQuote): Promise<void>;
    };
  };
  cashuReceiveQuoteService: { expire(quote: CashuReceiveQuote): Promise<void> };
  cashuSendQuoteService: {
    expireSendQuote(quote: CashuSendQuote): Promise<void>;
  };
  initiateMelt: InitiateMelt;
  getUserId: () => Promise<string | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * One leader-side reconciliation pass over the six unresolved/pending work-lists.
 * Cashu orchestrators own their WS subscriptions (idempotent; reconcile returns void).
 * Spark orchestrators return cleanup thunks (raw Breez listeners); the loop disposes
 * the prior tick's thunks before re-reconciling and on `dispose()`.
 */
export class TaskLoop {
  private sparkSendCleanup: (() => void) | null = null;
  private sparkReceiveCleanup: (() => void) | null = null;

  constructor(private readonly deps: TaskLoopDeps) {}

  async runOnce(): Promise<void> {
    // Always rotate the prior tick's spark listeners first — even on a no-user
    // tick (e.g. after logout), so leftover Breez listeners are torn down.
    this.disposeSparkThunks();

    const userId = await this.deps.getUserId();
    if (!userId) return;

    const { repos, orchestrators, initiateMelt } = this.deps;
    const [
      cashuSend,
      cashuSwap,
      cashuReceive,
      cashuReceiveSwap,
      sparkSend,
      sparkReceive,
    ] = await Promise.all([
      repos.cashuSendQuote.getUnresolved(userId),
      repos.cashuSendSwap.getUnresolved(userId),
      repos.cashuReceiveQuote.getPending(userId),
      repos.cashuReceiveSwap.getPending(userId),
      repos.sparkSendQuote.getUnresolved(userId),
      repos.sparkReceiveQuote.getPending(userId),
    ]);

    // Cashu — manager-owned, idempotent subscriptions (reconcile returns void).
    await orchestrators.cashuSend.reconcile(cashuSend);
    await this.sweepCashuSendExpiry(cashuSend);
    await orchestrators.cashuSendSwap.processDrafts(cashuSwap);
    await orchestrators.cashuSendSwap.reconcile(
      cashuSwap.filter((s) => s.state === 'PENDING'),
    );
    await orchestrators.cashuReceiveQuote.reconcileMintQuotes(cashuReceive);
    await orchestrators.cashuReceiveQuote.reconcileCrossMintMelts(
      cashuReceive.filter(
        (q): q is CashuReceiveQuote & { type: 'CASHU_TOKEN' } =>
          q.type === 'CASHU_TOKEN',
      ),
      { initiateMelt },
    );
    await orchestrators.cashuReceiveSwap.processPending(cashuReceiveSwap);
    await this.sweepCashuReceiveExpiry(cashuReceive);

    // Spark — caller-owned cleanup thunks (raw Breez listeners).
    this.sparkSendCleanup = await orchestrators.sparkSend.reconcile(sparkSend);
    this.sparkReceiveCleanup =
      await orchestrators.sparkReceive.reconcile(sparkReceive);
    await orchestrators.sparkReceive.reconcileCrossMintMelts(sparkReceive, {
      initiateMelt,
    });
    await this.sweepSparkReceiveExpiry(sparkReceive);
  }

  dispose(): void {
    this.disposeSparkThunks();
  }

  private isExpired(expiresAt: string | null | undefined): boolean {
    return expiresAt != null && new Date(expiresAt) < new Date();
  }

  private async sweepCashuSendExpiry(quotes: CashuSendQuote[]): Promise<void> {
    for (const quote of quotes) {
      if (quote.state !== 'UNPAID' || !this.isExpired(quote.expiresAt))
        continue;
      await this.deps.cashuSendQuoteService
        .expireSendQuote(quote)
        .catch((error) =>
          console.error('cashu send expiry failed', {
            quoteId: quote.id,
            cause: error,
          }),
        );
    }
  }

  private async sweepCashuReceiveExpiry(
    quotes: CashuReceiveQuote[],
  ): Promise<void> {
    for (const quote of quotes) {
      if (quote.state !== 'UNPAID' || !this.isExpired(quote.expiresAt))
        continue;
      try {
        await this.deps.cashuReceiveQuoteService.expire(quote);
        this.deps.emitter.emit('receive:expired', {
          quoteId: quote.id,
          protocol: 'cashu',
        });
      } catch (error) {
        console.error('cashu receive expiry failed', {
          quoteId: quote.id,
          cause: error,
        });
      }
    }
  }

  private async sweepSparkReceiveExpiry(
    quotes: SparkReceiveQuote[],
  ): Promise<void> {
    for (const quote of quotes) {
      await this.deps.orchestrators.sparkReceive
        .applyExpiry(quote)
        .catch((error) =>
          console.error('spark receive expiry failed', {
            quoteId: quote.id,
            cause: error,
          }),
        );
    }
  }

  private disposeSparkThunks(): void {
    this.sparkSendCleanup?.();
    this.sparkReceiveCleanup?.();
    this.sparkSendCleanup = null;
    this.sparkReceiveCleanup = null;
  }
}
