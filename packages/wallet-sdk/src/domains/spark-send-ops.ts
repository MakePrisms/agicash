import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from '../internal/services/spark-send-quote-service';
import type { SparkAccount } from './account-types';
import type { SparkSendQuote } from './spark-send-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: SparkSendQuoteService;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Sending Lightning from a spark account. `execute` persists the quote in UNPAID;
 * the background processor pays via Breez. No EXPIRED state. */
export class SparkSendOps {
  constructor(private readonly deps: Deps) {}

  /** A send quote (fees, balance check) for paying `paymentRequest`. Not persisted. */
  createLightningQuote(p: {
    account: SparkAccount;
    paymentRequest: string;
    amount?: Money<'BTC'>;
  }): Promise<SparkLightningQuote> {
    return this.deps.service.getLightningSendQuote({
      account: p.account,
      paymentRequest: p.paymentRequest,
      amount: p.amount,
    });
  }

  /** Persists the send quote (UNPAID); the processor initiates the payment. */
  async execute(p: {
    account: SparkAccount;
    quote: SparkLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<SparkSendQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createSendQuote({
      userId,
      account: p.account,
      quote: p.quote,
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  async executeAndAwait(p: {
    account: SparkAccount;
    quote: SparkLightningQuote;
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
      kind: 'send',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.deps.service.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.service.get(quoteId);
    if (!quote) return { status: 'pending' };
    switch (quote.state) {
      case 'COMPLETED':
        return {
          status: 'completed',
          result: {
            protocol: 'spark',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID, PENDING — non-terminal (no EXPIRED for spark send).
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
