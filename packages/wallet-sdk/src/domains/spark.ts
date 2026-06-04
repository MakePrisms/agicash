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
 * REACTIVE OVERLAY (design B): TanStack is hidden inside the SDK. The two `get` reads —
 * `spark.send.get(quoteId)` and `spark.receive.get(quoteId)` — are OBSERVABLE FETCHES → each
 * returns a `Query<T>`. Their fetch BODY is the no-cache service read (unchanged); the overlay
 * only wraps it via {@link toQuery} over the SDK-internal `QueryClient` and MEMOISES per key
 * (`#q`), so repeated calls with the same id return the SAME stable `Query` ref (matching the
 * per-key memo the other reactive domains use, e.g. `accounts.get` / `cashu.send.get`). Realtime /
 * the orchestrator (PR5d / Slice 5) write the same client to push fresh values to subscribers.
 * Every WRITE/ACTION (`createLightningQuote` / `failQuote` / `executeQuote`) stays a `Promise` —
 * lifted verbatim from the no-cache slice.
 *
 * **`executeQuote` — DEFERRED to the orchestrator sub-slice (PR5d).** This is the SAME decision
 * PR5b made for cashu's `executeQuote`, and for the same reason: the unified `executeQuote`
 * orchestrator (the build plan's single biggest net-new construct) absorbs master's six
 * React-resident `useProcess*Tasks` hooks — INCLUDING `spark-send-quote-hooks.ts#useProcessSparkSendQuoteTasks`
 * — into one framework-free state machine, kept as its own reviewable unit (build plan §1 + §4 +
 * risk callout). For spark specifically: `initiateSend` (Breez `sendPayment`) moves a quote
 * UNPAID → PENDING, but the TERMINAL transition (→ COMPLETED / FAILED) is driven by the Breez
 * `paymentSucceeded` / `paymentFailed` event callback — the same event-listener substrate
 * `SparkBalanceTracker` uses and that the orchestrator owns (it also emits `send:completed` /
 * `send:failed`). Building only spark's drive loop here would duplicate that substrate and split
 * the orchestrator across two PRs. PR5c therefore ships the IDEMPOTENT PRIMITIVES the orchestrator
 * sequences (`initiateSend` with `idempotencyKey: quote.id` / `complete` / `fail`) + the balance
 * source, and leaves `executeQuote` a documented {@link NotImplementedError} stub — see
 * {@link SparkSendOpsImpl.executeQuote}.
 *
 * @module
 */
import { getInvoiceFromLud16, isLNURLError } from '../internal/lib-lnurl';
import type { SparkReceiveQuoteService } from '../internal/spark-receive-quote-service';
import type { SparkSendQuoteService } from '../internal/spark-send-quote-service';
import type { SparkDomain, SparkReceiveOps, SparkSendOps } from '../domains';
import { DomainError, NotImplementedError } from '../errors';
import { type QueryClient, toQuery } from '../query';
import type { SparkAccount } from '../types/account';
import type { SessionResolver } from '../internal/session';
import type { Money } from '../types/money';
import type { Query } from '../types/query';
import type { SparkReceiveQuote, SparkSendQuote } from '../types/spark';

/**
 * Spark SEND operations. Holds the lightning-send service + the session (for the user id on the
 * create path). `get` / `failQuote` go through the service (which reads/writes the repo).
 */
export class SparkSendOpsImpl implements SparkSendOps {
  /**
   * Per-key memo of the `Query` handles `get` exposes, so repeated calls for the same id return
   * the SAME stable reference (consumers can use it as a `useSyncExternalStore`/effect
   * dependency). Hidden inside the SDK. Mirrors the per-key memo the other reactive domains use.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers; backs
   *   the observable `get` read).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly sendQuoteService: SparkSendQuoteService,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Memoise a `Query` per stringified key: the FIRST call for a key builds the `Query` via
   * {@link toQuery}; later calls return the same stable ref. Mirrors the per-key memo the other
   * reactive domains use (e.g. `accounts.get` / `cashu.send.get`).
   */
  #memo<T>(key: readonly unknown[], fn: () => Promise<T>): Query<T> {
    const id = JSON.stringify(key);
    let q = this.#q.get(id);
    if (!q) {
      q = toQuery<T>(this.client, key, fn);
      this.#q.set(id, q);
    }
    return q;
  }

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
   * DEFERRED (orchestrator sub-slice, PR5d). `executeQuote` IS the orchestrator — the
   * framework-free state machine that drives UNPAID → PENDING → COMPLETED/FAILED off Breez
   * `sendPayment` + its `paymentSucceeded` / `paymentFailed` event callback (master has only the
   * React `TaskProcessor` + `useProcessSparkSendQuoteTasks`). PR5c ships the idempotent primitives
   * it sequences (`initiateSend` with `idempotencyKey: quote.id`, `complete`, `fail`) but NOT the
   * drive loop. Throws {@link NotImplementedError}. (Same placement as cashu's `executeQuote`.)
   *
   * @param _quote - the quote to drive (full object on the kickoff path).
   */
  executeQuote(_quote: SparkSendQuote): Promise<SparkSendQuote> {
    throw new NotImplementedError(
      'spark.send.executeQuote (the orchestrator state machine lands in the PR5d orchestrator sub-slice, with cashu.send.executeQuote; PR5c ships the idempotent spark send primitives it drives)',
    );
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
   * Fetch a spark send quote by id — as an observable {@link Query}. The fetch body is the
   * no-cache service read (unchanged); the reactive overlay wraps it via {@link toQuery} and
   * MEMOISES per id (one `Query` per distinct id). `subscribe` fires with the quote/`null`;
   * `toPromise()` resolves to it.
   *
   * @param quoteId - the quote id.
   * @returns a stable `Query<SparkSendQuote | null>` (null if it does not exist).
   */
  get(quoteId: string): Query<SparkSendQuote | null> {
    return this.#memo(['sparkSend', quoteId], () =>
      this.sendQuoteService.get(quoteId),
    );
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
  /**
   * Per-key memo of the `Query` handles `get` exposes (same stable-ref discipline as the send
   * ops). Hidden inside the SDK.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers; backs
   *   the observable `get` read).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly receiveQuoteService: SparkReceiveQuoteService,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Memoise a `Query` per stringified key (mirrors the send ops + the other reactive domains).
   */
  #memo<T>(key: readonly unknown[], fn: () => Promise<T>): Query<T> {
    const id = JSON.stringify(key);
    let q = this.#q.get(id);
    if (!q) {
      q = toQuery<T>(this.client, key, fn);
      this.#q.set(id, q);
    }
    return q;
  }

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
   * Fetch a spark receive quote by id — as an observable {@link Query}. The fetch body is the
   * no-cache service read (unchanged); the reactive overlay wraps it via {@link toQuery} and
   * MEMOISES per id (one `Query` per distinct id). `subscribe` fires with the quote/`null`;
   * `toPromise()` resolves to it.
   *
   * @param quoteId - the quote id.
   * @returns a stable `Query<SparkReceiveQuote | null>` (null if it does not exist).
   */
  get(quoteId: string): Query<SparkReceiveQuote | null> {
    return this.#memo(['sparkReceive', quoteId], () =>
      this.receiveQuoteService.get(quoteId),
    );
  }
}

/** The spark domain — `.send` + `.receive`. */
export class SparkDomainImpl implements SparkDomain {
  constructor(
    readonly send: SparkSendOps,
    readonly receive: SparkReceiveOps,
  ) {}
}
