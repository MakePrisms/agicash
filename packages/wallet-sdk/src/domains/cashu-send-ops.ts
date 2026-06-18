import { encodeToken, getCashuProtocolUnit } from '@agicash/cashu';
import type { Money } from '@agicash/money';
import type { Big } from 'big.js';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { CashuSendQuoteRepository } from '../internal/db/cashu-send-quote-repository';
import type { CashuSendSwapRepository } from '../internal/db/cashu-send-swap-repository';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from '../internal/services/cashu-send-quote-service';
import type { CashuSendSwapService } from '../internal/services/cashu-send-swap-service';
import type { CashuAccount } from './account-types';
import { toProof } from './cashu-proof';
import type { CashuSendQuote, DestinationDetails } from './cashu-send-quote';
import type { CashuSendSwap } from './cashu-send-swap';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

/** The result of `createTokenSend`: the encoded token to share + the PENDING swap. */
export type CreateTokenSendResult = {
  token: string;
  swap: CashuSendSwap;
};

type Deps = {
  quoteService: CashuSendQuoteService;
  swapService: CashuSendSwapService;
  quoteRepository: CashuSendQuoteRepository;
  swapRepository: CashuSendSwapRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * Sending from a cashu account: Lightning melt (createLightningQuote → execute,
 * processor-driven) and offline token send (createTokenSend, foreground swap).
 * `awaitTerminal` covers both the send-quote and send-swap entities.
 */
export class CashuSendOps {
  constructor(private readonly deps: Deps) {}

  /** A melt quote (fees, proof selection) for paying `paymentRequest`. Not persisted.
   * `exchangeRate` is needed only for a non-BTC amount on an amountless invoice —
   * fetch it via `sdk.rates` at the call site. */
  createLightningQuote(p: {
    account: CashuAccount;
    paymentRequest: string;
    amount?: Money;
    exchangeRate?: Big;
  }): Promise<CashuLightningQuote> {
    return this.deps.quoteService.getLightningQuote({
      account: p.account,
      paymentRequest: p.paymentRequest,
      amount: p.amount,
      exchangeRate: p.exchangeRate,
    });
  }

  /** Persists the send quote (UNPAID); the processor melts. Create-only. */
  async execute(p: {
    account: CashuAccount;
    quote: CashuLightningQuote;
    destinationDetails?: DestinationDetails;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<CashuSendQuote> {
    const userId = await this.requireUserId();
    return this.deps.quoteService.createSendQuote({
      userId,
      account: p.account,
      sendQuote: {
        paymentRequest: p.quote.paymentRequest,
        amountRequested: p.quote.amountRequested,
        amountRequestedInBtc: p.quote.amountRequestedInBtc,
        meltQuote: p.quote.meltQuote,
      },
      destinationDetails: p.destinationDetails,
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  async executeAndAwait(p: {
    account: CashuAccount;
    quote: CashuLightningQuote;
    destinationDetails?: DestinationDetails;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  /**
   * Creates an offline (ecash token) send. Runs the swap synchronously so the
   * encoded token can be returned. Safe against the concurrent background swap
   * processor: the swap is idempotent (deterministic outputs + already-signed
   * recovery) and `swapForProofsToSend` guards on `state === 'DRAFT'`.
   */
  async createTokenSend(p: {
    account: CashuAccount;
    amount: Money;
  }): Promise<CreateTokenSendResult> {
    const userId = await this.requireUserId();
    const created = await this.deps.swapService.create({
      userId,
      account: p.account,
      amount: p.amount,
      senderPaysFee: true,
    });

    let swap = created;
    if (created.state === 'DRAFT') {
      await this.deps.swapService.swapForProofsToSend({
        account: p.account,
        swap: created,
      });
      const updated = await this.deps.swapRepository.get(created.id);
      if (!updated) throw new Error('Send swap not found after swap');
      swap = updated;
    }
    if (swap.state !== 'PENDING') {
      throw new Error(`Send swap is not pending: ${swap.state}`);
    }

    const token = encodeToken(
      {
        mint: p.account.mintUrl,
        proofs: swap.proofsToSend.map((proof) => toProof(proof)),
        unit: getCashuProtocolUnit(swap.amountToSend.currency),
      },
      { removeDleq: true },
    );

    return { token, swap };
  }

  /** Reclaims a PENDING token send by swapping the proofs back into the account. */
  reverse(p: { swap: CashuSendSwap; account: CashuAccount }): Promise<void> {
    return this.deps.swapService.reverse(p.swap, p.account);
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

  get(quoteId: string): Promise<CashuSendQuote | null> {
    return this.deps.quoteRepository.get(quoteId);
  }

  /** Backstop reads BOTH paths — a lightning send-quote and a token send-swap
   * both emit `send:*` keyed by their entity `id`. */
  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.quoteRepository.get(quoteId);
    if (quote) {
      switch (quote.state) {
        case 'PAID':
          return {
            status: 'completed',
            result: {
              protocol: 'cashu',
              quoteId: quote.id,
              transactionId: quote.transactionId,
              amount: quote.amountReceived,
            },
          };
        case 'EXPIRED':
          return {
            status: 'failed',
            error: new DomainError('Send quote expired'),
          };
        case 'FAILED':
          return {
            status: 'failed',
            error: new DomainError(quote.failureReason),
          };
        default:
          return { status: 'pending' };
      }
    }

    const swap = await this.deps.swapRepository.get(quoteId);
    if (swap) {
      switch (swap.state) {
        case 'COMPLETED':
          return {
            status: 'completed',
            result: {
              protocol: 'cashu',
              quoteId: swap.id,
              transactionId: swap.transactionId,
              amount: swap.amountReceived,
            },
          };
        case 'FAILED':
          return {
            status: 'failed',
            error: new DomainError(swap.failureReason),
          };
        case 'REVERSED':
          return {
            status: 'failed',
            error: new DomainError('Send swap reversed'),
          };
        default:
          return { status: 'pending' };
      }
    }

    return { status: 'pending' };
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
