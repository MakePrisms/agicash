import { getCashuUnit, sumProofs } from '@agicash/cashu';
import {
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import type { CashuReceiveQuote } from '../../../domains/cashu-receive-quote';
import type { WalletAccess } from '../../../engine';
import { MeltQuoteTracker } from '../../cashu/melt-quote-tracker';
import { MintQuoteTracker } from '../../cashu/mint-quote-tracker';
import type { CashuReceiveQuoteService } from '../../services/cashu-receive-quote-service';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import { classifyMintQuoteUpdate } from './mint-quote-classification';
import type { Processor } from './processor';

type CashuTokenReceiveQuote = CashuReceiveQuote & { type: 'CASHU_TOKEN' };

export type CashuReceiveQuoteProcessorDeps = {
  service: CashuReceiveQuoteService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuReceiveQuote[]>;
};

/**
 * Drives pending cashu receive quotes. The mint quote (NUT-04) is tracked via
 * MintQuoteTracker then classified (PAID/ISSUED→completeReceive, UNPAID+expired→expire).
 * CASHU_TOKEN quotes additionally melt a source token (NUT-05) via MeltQuoteTracker:
 * UNPAID→initiateMelt (or fail if already meltInitiated), PENDING→markMeltInitiated,
 * EXPIRED→expire. A MintOperationError during melt is terminal → fail. All transitions
 * on lane `cashu-receive-quote-${id}`. Port of `useProcessCashuReceiveQuoteTasks`.
 */
export class CashuReceiveQuoteProcessor implements Processor {
  private readonly mintTracker = new MintQuoteTracker();
  private readonly meltTracker = new MeltQuoteTracker();
  private workSet: CashuReceiveQuote[] = [];

  constructor(private readonly deps: CashuReceiveQuoteProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.workSet = await this.deps.fetchWorkSet(userId);

    this.mintTracker.update(
      this.workSet.map((quote) => {
        const account = this.deps.wallets.getCashuAccount(quote.accountId);
        return {
          quoteId: quote.quoteId,
          accountId: quote.accountId,
          mintUrl: account.mintUrl,
          currency: account.currency,
          state: quote.state,
          expiresAt: quote.expiresAt,
        };
      }),
      {
        getWallet: (accountId) =>
          this.deps.wallets.getCashuAccount(accountId).wallet,
        onUpdate: (mintQuote) => this.onMintUpdate(mintQuote),
      },
    );

    const tokenQuotes = this.workSet.filter(
      (quote): quote is CashuTokenReceiveQuote => quote.type === 'CASHU_TOKEN',
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
          this.runToken(meltQuote, (quote) =>
            this.deps.service.markMeltInitiated(quote),
          ),
        onExpired: (meltQuote) =>
          this.runToken(meltQuote, (quote) => this.deps.service.expire(quote)),
      },
    );
  }

  dispose(): void {
    this.mintTracker.dispose();
    this.meltTracker.dispose();
    this.workSet = [];
  }

  private onMintUpdate(mintQuote: MintQuoteBolt11Response): void {
    const quote = this.workSet.find((q) => q.quoteId === mintQuote.quote);
    if (!quote) return;
    const outcome = classifyMintQuoteUpdate(mintQuote.state, quote.expiresAt);
    if (!outcome) return;
    if (outcome === 'expired') {
      this.run(quote, (q) => this.deps.service.expire(q));
    } else {
      this.run(quote, (q) =>
        this.deps.service.completeReceive(
          this.deps.wallets.getCashuAccount(q.accountId),
          q,
        ),
      );
    }
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

  private initiateMelt(quote: CashuTokenReceiveQuote): void {
    void this.deps.runner
      .runTask(
        `cashu-receive-quote-${quote.id}`,
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
          console.error('Initiate melt error', {
            cause: error,
            receiveQuoteId: quote.id,
          });
        }
      });
  }

  private resolveToken(
    meltQuote: MeltQuoteBolt11Response,
  ): CashuTokenReceiveQuote | undefined {
    return this.workSet.find(
      (q): q is CashuTokenReceiveQuote =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuote.quote,
    );
  }

  private run(
    quote: CashuReceiveQuote,
    op: (quote: CashuReceiveQuote) => Promise<unknown>,
  ): void {
    void this.deps.runner
      .runTask(`cashu-receive-quote-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Cashu receive quote transition failed', {
          cause: error,
          receiveQuoteId: quote.id,
        }),
      );
  }

  private runToken(
    meltQuote: MeltQuoteBolt11Response,
    op: (quote: CashuTokenReceiveQuote) => Promise<unknown>,
  ): void {
    const quote = this.resolveToken(meltQuote);
    if (!quote) return;
    void this.deps.runner
      .runTask(`cashu-receive-quote-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Cashu receive quote melt transition failed', {
          cause: error,
          receiveQuoteId: quote.id,
        }),
      );
  }
}
