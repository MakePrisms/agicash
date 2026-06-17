import { getCashuUnit, sumProofs } from '@agicash/cashu';
import { type MeltQuoteBolt11Response, MintOperationError } from '@cashu/cashu-ts';
import type { SparkReceiveQuote } from '../../../domains/spark-receive-quote';
import type { WalletAccess } from '../../../engine';
import { MeltQuoteTracker } from '../../cashu/melt-quote-tracker';
import { SparkReceiveStateTracker } from '../../spark/spark-event-bridge';
import type { SparkReceiveQuoteService } from '../../services/spark-receive-quote-service';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import type { Processor } from './processor';

type SparkTokenReceiveQuote = SparkReceiveQuote & { type: 'CASHU_TOKEN' };

export type SparkReceiveQuoteProcessorDeps = {
  service: SparkReceiveQuoteService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<SparkReceiveQuote[]>;
};

/**
 * Drives pending spark receive quotes. The native lightning receive is tracked via
 * Breez events (SparkReceiveStateTracker → complete / expire). CASHU_TOKEN quotes
 * additionally melt a source token (NUT-05) via MeltQuoteTracker: UNPAID→initiateMelt
 * (or fail if already meltInitiated), PENDING→markMeltInitiated, EXPIRED→expire. A
 * MintOperationError during melt is terminal → fail. All transitions on lane
 * `spark-receive-quote-${id}` (the app's missing-hyphen typo on the melt-path lanes
 * is collapsed here). Port of `useProcessSparkReceiveQuoteTasks`.
 */
export class SparkReceiveQuoteProcessor implements Processor {
  private readonly sparkTracker = new SparkReceiveStateTracker();
  private readonly meltTracker = new MeltQuoteTracker();
  private workSet: SparkReceiveQuote[] = [];

  constructor(private readonly deps: SparkReceiveQuoteProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.workSet = await this.deps.fetchWorkSet(userId);

    this.sparkTracker.update(this.workSet, {
      getWallet: (accountId) => this.deps.wallets.getSparkAccount(accountId).wallet,
      onCompleted: (quoteId, { sparkTransferId, paymentPreimage }) =>
        this.complete(quoteId, paymentPreimage, sparkTransferId),
      onExpired: (quoteId) => this.expire(quoteId),
    });

    const tokenQuotes = this.workSet.filter(
      (quote): quote is SparkTokenReceiveQuote => quote.type === 'CASHU_TOKEN',
    );
    this.meltTracker.update(
      tokenQuotes.map((quote) => ({
        id: quote.tokenReceiveData.meltQuoteId,
        mintUrl: quote.tokenReceiveData.sourceMintUrl,
        currency: quote.tokenReceiveData.tokenAmount.currency,
        expiryInMs: new Date(quote.expiresAt).getTime(),
        inputAmount: sumProofs(quote.tokenReceiveData.tokenProofs),
      })),
      {
        getWallet: (mintUrl, currency) =>
          this.deps.wallets.getCashuWalletByMint(mintUrl, currency),
        onUnpaid: (meltQuote) => this.onMeltUnpaid(meltQuote),
        onPending: (meltQuote) =>
          this.runToken(meltQuote, (quote) => this.deps.service.markMeltInitiated(quote)),
        onExpired: (meltQuote) =>
          this.runToken(meltQuote, (quote) => this.deps.service.expire(quote)),
      },
    );
  }

  dispose(): void {
    this.sparkTracker.dispose();
    this.meltTracker.dispose();
    this.workSet = [];
  }

  private complete(quoteId: string, paymentPreimage: string, sparkTransferId: string): void {
    const quote = this.workSet.find((q) => q.id === quoteId);
    if (!quote) return;
    this.run(quote, (q) => this.deps.service.complete(q, paymentPreimage, sparkTransferId));
  }

  private expire(quoteId: string): void {
    const quote = this.workSet.find((q) => q.id === quoteId);
    if (!quote) return;
    this.run(quote, (q) => this.deps.service.expire(q));
  }

  private onMeltUnpaid(meltQuote: MeltQuoteBolt11Response): void {
    const quote = this.resolveToken(meltQuote);
    if (!quote) return;
    if (quote.tokenReceiveData.meltInitiated) {
      this.run(quote, (q) => this.deps.service.fail(q, 'Cashu token melt failed.'));
    } else {
      this.initiateMelt(quote);
    }
  }

  private initiateMelt(quote: SparkTokenReceiveQuote): void {
    void this.deps.runner
      .runTask(
        `spark-receive-quote-${quote.id}`,
        async () => {
          const wallet = await this.deps.wallets.getSourceCashuWallet(
            quote.tokenReceiveData.sourceMintUrl,
            quote.tokenReceiveData.tokenAmount.currency,
          );
          await wallet.meltProofsIdempotent(
            {
              quote: quote.tokenReceiveData.meltQuoteId,
              amount: quote.amount.toNumber(getCashuUnit(quote.amount.currency)),
            },
            quote.tokenReceiveData.tokenProofs,
            undefined,
            // See claim-cashu-token-service.ts for rationale on random outputs.
            { type: 'random' },
          );
        },
        defaultRetryPolicy,
      )
      .catch((error) => {
        if (error instanceof MintOperationError) {
          this.run(quote, (q) => this.deps.service.fail(q, error.message));
        } else {
          console.error('Initiate melt error', { cause: error, receiveQuoteId: quote.id });
        }
      });
  }

  private resolveToken(
    meltQuote: MeltQuoteBolt11Response,
  ): SparkTokenReceiveQuote | undefined {
    return this.workSet.find(
      (q): q is SparkTokenReceiveQuote =>
        q.type === 'CASHU_TOKEN' && q.tokenReceiveData.meltQuoteId === meltQuote.quote,
    );
  }

  private run(
    quote: SparkReceiveQuote,
    op: (quote: SparkReceiveQuote) => Promise<unknown>,
  ): void {
    void this.deps.runner
      .runTask(`spark-receive-quote-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Spark receive quote transition failed', {
          cause: error,
          receiveQuoteId: quote.id,
        }),
      );
  }

  private runToken(
    meltQuote: MeltQuoteBolt11Response,
    op: (quote: SparkTokenReceiveQuote) => Promise<unknown>,
  ): void {
    const quote = this.resolveToken(meltQuote);
    if (!quote) return;
    void this.deps.runner
      .runTask(`spark-receive-quote-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Spark receive quote melt transition failed', {
          cause: error,
          receiveQuoteId: quote.id,
        }),
      );
  }
}
