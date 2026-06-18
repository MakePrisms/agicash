import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { CashuReceiveLightningQuote } from '../internal/cashu/receive-quote-core';
import type { CashuReceiveQuoteRepository } from '../internal/db/cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from '../internal/services/cashu-receive-quote-service';
import type { CashuAccount } from './account-types';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: CashuReceiveQuoteService;
  repository: CashuReceiveQuoteRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Receiving Lightning into a cashu account. `execute` persists the quote so the
 * background processor mints on payment; `awaitTerminal` resolves on COMPLETED. */
export class CashuReceiveOps {
  constructor(private readonly deps: Deps) {}

  /** A locked mint quote (bolt11 invoice) to receive `amount`. Not persisted. */
  createLightningQuote(p: {
    account: CashuAccount;
    amount: Money;
    description?: string;
  }): Promise<CashuReceiveLightningQuote> {
    return this.deps.service.getLightningQuote({
      wallet: p.account.wallet,
      amount: p.amount,
      description: p.description,
    });
  }

  /** Persists the receive quote so the processor tracks payment. Create-only. */
  async execute(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<CashuReceiveQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createReceiveQuote({
      userId,
      account: p.account,
      lightningQuote: p.quote,
      receiveType: 'LIGHTNING',
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  /** Persists then resolves when the payment completes (or fails/expires). */
  async executeAndAwait(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'receive',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<CashuReceiveQuote | null> {
    return this.deps.repository.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.repository.get(quoteId);
    if (!quote) return { status: 'pending' };
    switch (quote.state) {
      case 'COMPLETED':
        return {
          status: 'completed',
          result: {
            protocol: 'cashu',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'EXPIRED':
        return { status: 'expired' };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID, PAID — PAID is non-terminal (COMPLETED fires later).
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
