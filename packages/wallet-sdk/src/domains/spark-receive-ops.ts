import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import {
  type SparkReceiveLightningQuote,
  getLightningQuote as getSparkReceiveLightningQuote,
} from '../internal/spark/receive-quote-core';
import type { SparkReceiveQuoteService } from '../internal/services/spark-receive-quote-service';
import type { SparkAccount } from './account-types';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: SparkReceiveQuoteService;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Receiving Lightning into a spark account. PAID is terminal (no separate
 * COMPLETED), so `awaitTerminal` resolves on PAID. */
export class SparkReceiveOps {
  constructor(private readonly deps: Deps) {}

  /** A bolt11 invoice to receive `amount`. Not persisted. */
  createLightningQuote(p: {
    account: SparkAccount;
    amount: Money;
    description?: string;
  }): Promise<SparkReceiveLightningQuote> {
    return getSparkReceiveLightningQuote({
      wallet: p.account.wallet,
      amount: p.amount,
      description: p.description,
    });
  }

  /** Persists the receive quote so the processor tracks payment. Create-only. */
  async execute(p: {
    account: SparkAccount;
    quote: SparkReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<SparkReceiveQuote> {
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

  async executeAndAwait(p: {
    account: SparkAccount;
    quote: SparkReceiveLightningQuote;
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

  get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.deps.service.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.service.get(quoteId);
    if (!quote) return { status: 'pending' };
    // Terminal sets must stay in lockstep with internal/realtime/lifecycle-events.ts.
    switch (quote.state) {
      case 'PAID':
        return {
          status: 'completed',
          result: {
            protocol: 'spark',
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
        // UNPAID — non-terminal.
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
