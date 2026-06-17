import { sumProofs } from '@agicash/cashu';
import { type MeltQuoteBolt11Response, MintOperationError } from '@cashu/cashu-ts';
import type { CashuSendQuote } from '../../../domains/cashu-send-quote';
import type { WalletAccess } from '../../../engine';
import { MeltQuoteTracker } from '../../cashu/melt-quote-tracker';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import type { CashuSendQuoteService } from '../../services/cashu-send-quote-service';
import type { Processor } from './processor';

export type CashuSendQuoteProcessorDeps = {
  service: CashuSendQuoteService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuSendQuote[]>;
};

/**
 * Drives unresolved cashu send quotes off their destination melt quote (NUT-17):
 * UNPAID→initiateSend (on its own lane so markPending need not wait behind an
 * in-flight initiate), PENDING→markSendQuoteAsPending, PAID→completeSendQuote,
 * EXPIRED→expireSendQuote. A MintOperationError on initiate is terminal →
 * failSendQuote. Port of `useProcessCashuSendQuoteTasks`.
 */
export class CashuSendQuoteProcessor implements Processor {
  private readonly tracker = new MeltQuoteTracker();
  private workSet: CashuSendQuote[] = [];

  constructor(private readonly deps: CashuSendQuoteProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.workSet = await this.deps.fetchWorkSet(userId);
    this.tracker.update(
      this.workSet.map((quote) => {
        const account = this.deps.wallets.getCashuAccount(quote.accountId);
        return {
          id: quote.quoteId, // the destination melt-quote id
          mintUrl: account.mintUrl,
          currency: account.currency,
          expiryInMs: new Date(quote.expiresAt).getTime(),
          inputAmount: sumProofs(quote.proofs),
        };
      }),
      {
        getWallet: (mintUrl, currency) =>
          this.deps.wallets.getCashuWalletByMint(mintUrl, currency),
        onUnpaid: (meltQuote) => this.onUnpaid(meltQuote),
        onPending: (meltQuote) =>
          this.run(meltQuote, (quote) =>
            this.deps.service.markSendQuoteAsPending(quote),
          ),
        onPaid: (meltQuote) =>
          this.run(meltQuote, (quote) =>
            this.deps.service.completeSendQuote(
              this.deps.wallets.getCashuAccount(quote.accountId),
              quote,
              meltQuote,
            ),
          ),
        onExpired: (meltQuote) =>
          this.run(meltQuote, (quote) =>
            this.deps.service.expireSendQuote(quote),
          ),
      },
    );
  }

  dispose(): void {
    this.tracker.dispose();
    this.workSet = [];
  }

  private resolve(meltQuote: MeltQuoteBolt11Response): CashuSendQuote | undefined {
    return this.workSet.find((quote) => quote.quoteId === meltQuote.quote);
  }

  private onUnpaid(meltQuote: MeltQuoteBolt11Response): void {
    const quote = this.resolve(meltQuote);
    // The mint flips the melt quote back to UNPAID after a failed pay; only
    // (re)initiate while our send quote is itself still UNPAID.
    if (!quote || quote.state !== 'UNPAID') return;
    void this.deps.runner
      .runTask(
        `initiate-cashu-send-quote-${quote.id}`,
        () =>
          this.deps.service.initiateSend(
            this.deps.wallets.getCashuAccount(quote.accountId),
            quote,
            meltQuote,
          ),
        defaultRetryPolicy,
      )
      .catch((error) => {
        if (error instanceof MintOperationError) {
          this.fail(quote, error.message);
        } else {
          console.error('Initiate send error', {
            cause: error,
            sendQuoteId: quote.id,
          });
        }
      });
  }

  private fail(quote: CashuSendQuote, reason: string): void {
    void this.deps.runner
      .runTask(
        `cashu-send-quote-${quote.id}`,
        async () => {
          const account = this.deps.wallets.getCashuAccount(quote.accountId);
          const failed = await this.deps.service.failSendQuote(account, quote, reason);
          // Drop the melt sub so a re-initiated send (new quote, same melt) resubscribes.
          this.tracker.removeQuoteFromSubscription({
            mintUrl: account.mintUrl,
            quoteId: failed.quoteId,
          });
        },
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Failed to mark payment as failed', {
          cause: error,
          sendQuoteId: quote.id,
        }),
      );
  }

  private run(
    meltQuote: MeltQuoteBolt11Response,
    op: (quote: CashuSendQuote) => Promise<unknown>,
  ): void {
    const quote = this.resolve(meltQuote);
    if (!quote) return;
    void this.deps.runner
      .runTask(`cashu-send-quote-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Cashu send quote transition failed', {
          cause: error,
          sendQuoteId: quote.id,
        }),
      );
  }
}
