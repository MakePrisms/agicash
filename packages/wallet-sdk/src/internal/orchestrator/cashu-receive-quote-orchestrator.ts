import {
  type MintQuoteBolt11Response,
  MintQuoteState,
} from '@cashu/cashu-ts';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import type { SdkEventEmitter } from '../event-emitter';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';
import type { MintQuoteSubscriptionManager } from '../lib/cashu/mint-quote-subscription-manager';

export type CashuReceiveQuoteOrchestratorDeps = {
  receiveQuoteService: CashuReceiveQuoteService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  mintSubscriptionManager: MintQuoteSubscriptionManager;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives cashu lightning receives (mint-quote WS → completeReceive) and the
 * cross-mint CASHU_TOKEN melt sub-flow (melt-quote WS → initiateMelt/markMeltInitiated).
 * Quote expiry is loop-driven (S9), not handled here.
 */
export class CashuReceiveQuoteOrchestrator {
  constructor(private readonly deps: CashuReceiveQuoteOrchestratorDeps) {}

  async applyMintQuoteState(
    account: CashuAccount,
    quote: CashuReceiveQuote,
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    if (
      mintQuote.state !== MintQuoteState.PAID &&
      mintQuote.state !== MintQuoteState.ISSUED
    ) {
      return;
    }
    const result = await this.deps.receiveQuoteService.completeReceive(account, quote);
    if (result.quote.state === 'COMPLETED') {
      this.deps.emitter.emit('receive:completed', {
        quoteId: result.quote.id,
        transactionId: result.quote.transactionId,
        amount: result.quote.amount,
        protocol: 'cashu',
      });
    }
  }

  /** Subscribe the mint-quote websocket for the given pending LIGHTNING/CASHU_TOKEN receive quotes. */
  async reconcileMintQuotes(quotes: CashuReceiveQuote[]): Promise<void> {
    if (quotes.length === 0) return;
    const byQuoteId = new Map<string, CashuReceiveQuote>();
    const idsByMint = new Map<string, string[]>();
    for (const quote of quotes) {
      const account = await this.deps.getAccount(quote.accountId);
      if (!account) continue;
      byQuoteId.set(quote.quoteId, quote);
      const list = idsByMint.get(account.mintUrl) ?? [];
      list.push(quote.quoteId);
      idsByMint.set(account.mintUrl, list);
    }
    for (const [mintUrl, quoteIds] of idsByMint) {
      await this.deps.mintSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (mintQuote) => {
          void this.onMintUpdate(byQuoteId, mintQuote).catch((error) =>
            console.error('cashu receive mint update failed', { cause: error }),
          );
        },
      });
    }
  }

  private async onMintUpdate(
    byQuoteId: Map<string, CashuReceiveQuote>,
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    const quote = byQuoteId.get(mintQuote.quote);
    if (!quote) return;
    const account = await this.deps.getAccount(quote.accountId);
    if (!account) return;
    await this.applyMintQuoteState(account, quote, mintQuote);
  }

  // applyCrossMintMeltState + reconcileCrossMintMelts land in Task 10.
}
