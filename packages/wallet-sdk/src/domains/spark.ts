/**
 * `SparkDomain` implementation — §6 of the contract, Slice 3 / PR5c (spark send + receive ops).
 *
 * Wires the framework-free spark SERVICE primitives (`internal/spark-*-service.ts`, re-housed
 * from `apps/web-wallet/app/features/{send,receive}/*`) into the public `SparkSendOps` /
 * `SparkReceiveOps` surface, replacing PR2's `createSparkStub`. The services drive the account's
 * LIVE `BreezSdk` handle (PR5a) + the SDK-owned Supabase repos. Mirrors PR5b's `domains/cashu.ts`.
 *
 * TWO-MODE API rule: `createLightningQuote` is a kickoff (params + the FULL account);
 * `failQuote` takes the FULL quote; `get` is a fetch.
 *
 * **`executeQuote` — wired through the orchestrator (PR5d).** The unified `executeQuote`
 * orchestrator (the build plan's single biggest net-new construct) absorbs master's six
 * React-resident `useProcess*Tasks` hooks — INCLUDING `spark-send-quote-hooks.ts#useProcessSparkSendQuoteTasks`
 * — into one framework-free state machine. For spark: `executeQuote` hands the full quote to the
 * shared {@link Orchestrator}, which calls `initiateSend` (Breez `sendPayment`, UNPAID → PENDING)
 * immediately; the TERMINAL transition (→ COMPLETED / FAILED) is driven by the Breez
 * `paymentSucceeded` / `paymentFailed` event surfaced to the orchestrator's `stepSparkSend*` cores
 * (the same event substrate `SparkBalanceTracker` uses, whose wiring lands with the S5 spark-event
 * forwarder). PR5c ships the IDEMPOTENT PRIMITIVES the orchestrator sequences (`initiateSend` with
 * `idempotencyKey: quote.id` / `complete` / `fail`). `executeQuote` resolves on KICK-OFF.
 *
 * @module
 */
import { getInvoiceFromLud16, isLNURLError } from '../internal/lib-lnurl';
import type { Orchestrator } from '../internal/orchestrator';
import type { SparkReceiveQuoteService } from '../internal/spark-receive-quote-service';
import type { SparkSendQuoteService } from '../internal/spark-send-quote-service';
import type { SparkDomain, SparkReceiveOps, SparkSendOps } from '../domains';
import { DomainError } from '../errors';
import type { SparkAccount } from '../types/account';
import type { SessionResolver } from '../internal/session';
import type { Money } from '../types/money';
import type { SparkReceiveQuote, SparkSendQuote } from '../types/spark';

/**
 * Spark SEND operations. Holds the lightning-send service + the session (for the user id on the
 * create path). `get` / `failQuote` go through the service (which reads/writes the repo).
 */
export class SparkSendOpsImpl implements SparkSendOps {
  constructor(
    private readonly sendQuoteService: SparkSendQuoteService,
    private readonly session: SessionResolver,
    private readonly orchestrator: Orchestrator,
  ) {}

  /**
   * Create a spark lightning send quote. `destination` is a bolt11 invoice OR a Lightning
   * address; an ln-address is resolved internally via LNURL-pay using `amount` (the contract's
   * fold, §3 — NOT a scan step). Then delegates to the send service (`getLightningSendQuote` +
   * `createSendQuote`).
   *
   * @param params.account - the FULL spark account to send from (its live Breez wallet is used).
   * @param params.destination - a bolt11 invoice or a `user@domain` Lightning address.
   * @param params.amount - required for an ln-address / amountless invoice (BTC).
   * @returns the created {@link SparkSendQuote} (UNPAID).
   */
  async createLightningQuote(params: {
    account: SparkAccount;
    destination: string;
    amount?: Money;
  }): Promise<SparkSendQuote> {
    const user = await this.session.requireCurrentUser();
    const { paymentRequest } = await this.resolveDestination(
      params.destination,
      params.amount,
    );

    const lightningQuote = await this.sendQuoteService.getLightningSendQuote({
      account: params.account,
      paymentRequest,
      amount: params.amount as Money<'BTC'> | undefined,
    });

    return this.sendQuoteService.createSendQuote({
      userId: user.id,
      account: params.account,
      quote: lightningQuote,
    });
  }

  /**
   * Execute a spark lightning send — THE orchestrator. Hands the full quote to the shared
   * {@link Orchestrator}, which calls Breez `sendPayment` (UNPAID → PENDING) immediately and emits
   * `send:pending`; the terminal transition (→ COMPLETED / FAILED) arrives via the account's Breez
   * `paymentSucceeded` / `paymentFailed` event (surfaced to `stepSparkSend*`, wired by the S5
   * spark-event forwarder), emitting `send:completed` / `send:failed`. PR5c's `initiateSend`
   * (`idempotencyKey: quote.id`) keeps a re-issue safe. Resolves on KICK-OFF (returns the quote in
   * its now-PENDING state); the terminal arrives via events or `.get(id)`.
   *
   * @param quote - the FULL send quote (full object on the kickoff path).
   * @returns the quote after initiation (PENDING), or unchanged if past UNPAID.
   */
  executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote> {
    return this.orchestrator.executeSparkSendQuote(quote);
  }

  /**
   * Mark a send quote FAILED (FULL object). Delegates to the service (which guards the state).
   *
   * @param quote - the FULL quote to fail.
   * @param reason - the failure reason.
   */
  async failQuote(quote: SparkSendQuote, reason: string): Promise<void> {
    await this.sendQuoteService.fail(quote, reason);
  }

  /**
   * Fetch a spark send quote by id (fetch).
   *
   * @param quoteId - the quote id.
   * @returns the quote, or null.
   */
  async get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.sendQuoteService.get(quoteId);
  }

  /**
   * Resolve `destination` to a bolt11 invoice. A `user@domain` Lightning address is resolved via
   * LNURL-pay using `amount` (required, BTC); a bolt11 invoice is returned as-is. Mirrors the
   * cashu send domain's fold.
   */
  private async resolveDestination(
    destination: string,
    amount?: Money,
  ): Promise<{ paymentRequest: string }> {
    if (!destination.includes('@')) {
      return { paymentRequest: destination };
    }

    if (!amount) {
      throw new DomainError('An amount is required to pay a Lightning address');
    }
    if (amount.currency !== 'BTC') {
      throw new DomainError(
        'A BTC amount is required to pay a Lightning address',
      );
    }

    const invoiceResult = await getInvoiceFromLud16(
      destination,
      amount as Money<'BTC'>,
    );
    if (isLNURLError(invoiceResult)) {
      throw new DomainError(invoiceResult.reason);
    }
    return { paymentRequest: invoiceResult.pr };
  }
}

/**
 * Spark RECEIVE operations. Holds the receive-quote service + the session (for the user id on the
 * create path).
 */
export class SparkReceiveOpsImpl implements SparkReceiveOps {
  constructor(
    private readonly receiveQuoteService: SparkReceiveQuoteService,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Create a spark lightning receive quote (an invoice to be paid). `purpose` defaults to
   * `'PAYMENT'`; `'BUY_CASHAPP'` is the buy-bitcoin / Cash App flow. Delegates to the receive
   * service (`getLightningQuote` via the account's live Breez wallet + `createReceiveQuote`).
   *
   * @param params.account - the FULL spark account to receive into.
   * @param params.amount - the amount to receive.
   * @param params.description - an optional invoice description (overridden by the BUY_CASHAPP
   *   description when `purpose === 'BUY_CASHAPP'`).
   * @param params.purpose - `'PAYMENT'` (default) or `'BUY_CASHAPP'`.
   * @returns the created {@link SparkReceiveQuote} (UNPAID).
   */
  async createLightningQuote(params: {
    account: SparkAccount;
    amount: Money;
    description?: string;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<SparkReceiveQuote> {
    const user = await this.session.requireCurrentUser();
    const description =
      params.purpose === 'BUY_CASHAPP' ? 'Pay to Agicash' : params.description;

    const lightningQuote = await this.receiveQuoteService.getLightningQuote({
      wallet: params.account.wallet,
      amount: params.amount,
      description,
    });

    return this.receiveQuoteService.createReceiveQuote({
      userId: user.id,
      account: params.account,
      lightningQuote,
      receiveType: 'LIGHTNING',
      purpose: params.purpose ?? 'PAYMENT',
    });
  }

  /**
   * Fetch a spark receive quote by id (fetch).
   *
   * @param quoteId - the quote id.
   * @returns the quote, or null.
   */
  async get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.receiveQuoteService.get(quoteId);
  }
}

/** The spark domain — `.send` + `.receive`. */
export class SparkDomainImpl implements SparkDomain {
  constructor(
    readonly send: SparkSendOps,
    readonly receive: SparkReceiveOps,
  ) {}
}
