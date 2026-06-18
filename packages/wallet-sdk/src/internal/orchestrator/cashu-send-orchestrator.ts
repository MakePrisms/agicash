import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  MintOperationError,
} from '@cashu/cashu-ts';
import type { CashuSendQuoteService } from '../../domains/cashu/cashu-send-quote-service';
import { SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { SdkEventEmitter } from '../event-emitter';
import { sumProofs } from '../lib/cashu';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';
import type { CashuSendQuoteRepository } from '../repositories/cashu-send-quote-repository';

export type CashuSendOrchestratorDeps = {
  sendQuoteService: CashuSendQuoteService;
  sendQuoteRepository: CashuSendQuoteRepository;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives a cashu lightning send through UNPAID → PENDING → PAID off the mint's
 * melt-quote websocket. The kickoff (`initiateSend`) is triggered when the mint
 * reports the melt quote UNPAID; PAID completion derives change proofs (see the
 * nutshell-#788 guard in `resolvePaidMeltQuote`). Lifecycle (subscription start/
 * stop, leader election) is owned by the background loop (S9).
 */
export class CashuSendOrchestrator {
  constructor(private readonly deps: CashuSendOrchestratorDeps) {}

  async applyMeltQuoteState(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const { sendQuoteService, emitter } = this.deps;

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (sendQuote.state !== 'UNPAID') return;
      try {
        await sendQuoteService.initiateSend(account, sendQuote, meltQuote);
      } catch (error) {
        if (error instanceof MintOperationError) {
          try {
            const failed = await sendQuoteService.failSendQuote(
              account,
              sendQuote,
              error.message,
            );
            emitter.emit('send:failed', {
              quoteId: failed.id,
              error: new SdkError(error.message, 'cashu_send_failed'),
              protocol: 'cashu',
            });
          } catch (failError) {
            // failSendQuote refuses to fail a melt quote that is not UNPAID (the melt
            // is actually in-flight/paid). Don't suppress recovery — let the next
            // melt-quote WS tick (PENDING/PAID) drive the quote forward.
            console.error(
              'cashu send: failSendQuote did not apply after MintOperationError',
              { quoteId: sendQuote.id, cause: failError },
            );
          }
          return;
        }
        throw error;
      }
      return;
    }

    if (meltQuote.state === MeltQuoteState.PENDING) {
      if (sendQuote.state !== 'UNPAID') return;
      const updated = await sendQuoteService.markSendQuoteAsPending(sendQuote);
      if (updated.state === 'PENDING') {
        emitter.emit('send:pending', {
          quoteId: updated.id,
          transactionId: updated.transactionId,
          protocol: 'cashu',
        });
      }
      return;
    }

    if (meltQuote.state === MeltQuoteState.PAID) {
      if (sendQuote.state !== 'UNPAID' && sendQuote.state !== 'PENDING') return;
      const resolved = await this.resolvePaidMeltQuote(
        account,
        sendQuote,
        meltQuote,
      );
      const completed = await sendQuoteService.completeSendQuote(
        account,
        sendQuote,
        resolved,
      );
      if (completed.state === 'PAID') {
        emitter.emit('send:completed', {
          quoteId: completed.id,
          transactionId: completed.transactionId,
          amount: completed.amountRequested,
          protocol: 'cashu',
        });
      }
    }
  }

  /**
   * One reconciliation pass over the given unresolved send quotes: subscribe the
   * mint's melt-quote websocket (one per mint), routing each update through
   * `applyMeltQuoteState`. Idempotent per tick (the manager dedupes via isSubset).
   */
  async reconcile(quotes: CashuSendQuote[]): Promise<void> {
    if (quotes.length === 0) return;

    const byQuoteId = new Map<string, CashuSendQuote>();
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
      await this.deps.meltSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (meltQuote) => {
          void this.onMeltUpdate(byQuoteId, meltQuote).catch((error) =>
            console.error('cashu send melt update failed', { cause: error }),
          );
        },
      });
    }
  }

  private async onMeltUpdate(
    byQuoteId: Map<string, CashuSendQuote>,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const sendQuote = byQuoteId.get(meltQuote.quote);
    if (!sendQuote) return;
    const account = await this.deps.getAccount(sendQuote.accountId);
    if (!account) return;
    await this.applyMeltQuoteState(account, sendQuote, meltQuote);
  }

  /**
   * nutshell #788: the melt PAID websocket payload sometimes omits `change`.
   * When change is expected (input proofs exceed the melt amount) but absent,
   * refetch the melt quote so `completeSendQuote` can derive the change proofs;
   * otherwise the user's change ecash is silently lost.
   * https://github.com/cashubtc/nutshell/pull/788
   */
  protected async resolvePaidMeltQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<MeltQuoteBolt11Response> {
    const inputAmount = sumProofs(sendQuote.proofs);
    const expectChange = inputAmount > meltQuote.amount;
    if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
      return account.wallet.checkMeltQuoteBolt11(sendQuote.quoteId);
    }
    return meltQuote;
  }
}
