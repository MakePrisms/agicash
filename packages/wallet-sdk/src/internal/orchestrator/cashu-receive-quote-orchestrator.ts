import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  type MintQuoteBolt11Response,
  MintQuoteState,
} from '@cashu/cashu-ts';
import { SdkError } from '../../errors';
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
    const result = await this.deps.receiveQuoteService.completeReceive(
      account,
      quote,
    );
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

  /**
   * Cross-mint CASHU_TOKEN claim: react to the SOURCE-mint melt quote.
   * - UNPAID + not yet initiated → (re)initiate the melt.
   * - UNPAID + already initiated → the melt failed → fail the receive quote.
   * - PENDING → record that the melt is in flight.
   * Destination receive completion runs via the mint-quote path (applyMintQuoteState).
   */
  async applyCrossMintMeltState(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
    meltQuote: MeltQuoteBolt11Response,
    handlers: {
      initiateMelt: (
        quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
      ) => Promise<void>;
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
            'cashu_token_melt_failed',
          ),
          protocol: 'cashu',
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

  /**
   * Subscribe the SOURCE-mint melt-quote websocket for pending CASHU_TOKEN receive
   * quotes, routing each update through `applyCrossMintMeltState`. `initiateMelt`
   * is injected because the actual melt runs on the source wallet, resolved by the
   * caller (S9 wiring); the orchestrator only decides WHEN to melt.
   */
  async reconcileCrossMintMelts(
    quotes: (CashuReceiveQuote & { type: 'CASHU_TOKEN' })[],
    handlers: {
      initiateMelt: (
        quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
      ) => Promise<void>;
    },
  ): Promise<void> {
    if (quotes.length === 0) return;
    const triggered = new Set<string>();
    const byMeltQuoteId = new Map<
      string,
      CashuReceiveQuote & { type: 'CASHU_TOKEN' }
    >();
    const idsByMint = new Map<string, string[]>();
    for (const quote of quotes) {
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
              console.error('cashu receive cross-mint melt update failed', {
                quoteId: quote.id,
                cause: error,
              }),
          );
        },
      });
    }
  }
}
