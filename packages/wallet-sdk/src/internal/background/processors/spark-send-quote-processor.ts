import { DomainError } from '../../../errors';
import type { SparkSendQuote } from '../../../domains/spark-send-quote';
import type { WalletAccess } from '../../../engine';
import { SparkSendStateTracker } from '../../spark/spark-event-bridge';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import type { SparkSendQuoteService } from '../../services/spark-send-quote-service';
import type { Processor } from './processor';

export type SparkSendQuoteProcessorDeps = {
  service: SparkSendQuoteService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<SparkSendQuote[]>;
};

/**
 * Drives unresolved spark send quotes off Breez payment events: UNPAID→initiateSend
 * (a DomainError there is terminal → fail), paymentSucceeded→completeSendQuote,
 * paymentFailed→failSendQuote. All on lane `spark-send-quote-${id}`. The app's
 * `isPending` re-entrancy guards are dropped — the tracker's per-quote dedup + the
 * lane FIFO + the work-set re-resolve subsume them. Port of `useProcessSparkSendQuoteTasks`.
 */
export class SparkSendQuoteProcessor implements Processor {
  private readonly tracker = new SparkSendStateTracker();
  private workSet: SparkSendQuote[] = [];

  constructor(private readonly deps: SparkSendQuoteProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.workSet = await this.deps.fetchWorkSet(userId);
    this.tracker.update(this.workSet, {
      getWallet: (accountId) => this.deps.wallets.getSparkAccount(accountId).wallet,
      onUnpaid: (quote) => this.initiate(quote),
      onCompleted: (quote, { paymentPreimage }) => this.complete(quote, paymentPreimage),
      onFailed: (quote, reason) => this.fail(quote.id, reason),
    });
  }

  dispose(): void {
    this.tracker.dispose();
    this.workSet = [];
  }

  private resolve(quoteId: string): SparkSendQuote | undefined {
    return this.workSet.find((quote) => quote.id === quoteId);
  }

  private initiate(quote: SparkSendQuote): void {
    if (this.resolve(quote.id)?.state !== 'UNPAID') return;
    void this.deps.runner
      .runTask(
        `spark-send-quote-${quote.id}`,
        () =>
          this.deps.service
            .initiateSend({
              account: this.deps.wallets.getSparkAccount(quote.accountId),
              sendQuote: quote,
            })
            .catch((error) => {
              if (error instanceof DomainError) {
                this.fail(quote.id, error.message);
                return;
              }
              throw error;
            }),
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Initiate spark send quote error', {
          cause: error,
          sendQuoteId: quote.id,
        }),
      );
  }

  private complete(quote: SparkSendQuote, paymentPreimage: string): void {
    if (!this.resolve(quote.id)) return;
    void this.deps.runner
      .runTask(
        `spark-send-quote-${quote.id}`,
        () => this.deps.service.complete(quote, paymentPreimage),
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Complete spark send quote error', {
          cause: error,
          sendQuoteId: quote.id,
        }),
      );
  }

  private fail(quoteId: string, reason: string): void {
    const quote = this.resolve(quoteId);
    if (!quote) return;
    void this.deps.runner
      .runTask(
        `spark-send-quote-${quoteId}`,
        () => this.deps.service.fail(quote, reason),
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Failed to mark spark send quote as failed', {
          cause: error,
          sendQuoteId: quoteId,
        }),
      );
  }
}
