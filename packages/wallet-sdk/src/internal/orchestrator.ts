/**
 * The unified `executeQuote` ORCHESTRATOR — Slice 3 / PR5d. The build plan's single biggest
 * net-new construct (master has NO `executeQuote`).
 *
 * This is a framework-free state machine that absorbs master's six React-resident
 * `useProcess*Tasks` hooks (each a TanStack mutation + retry/`MintOperationError` branch + a live
 * mint-WS `*SubscriptionManager` / Breez event listener) into plain async methods. It DRIVES the
 * idempotent service primitives PR5b/5c already built (`initiateSend` / `markSendQuoteAsPending` /
 * `completeSendQuote` / `failSendQuote`, the swap/claim/receive services, with their `wallet.restore`
 * recovery + DB reservation / CONCURRENCY_ERROR guards) — it does NOT reimplement them.
 *
 * THE #1 CORRECTNESS SUBSTITUTION — DB-read, not cache. Master's hooks read
 * `unresolved*Cache.get(id)` (a TanStack cache) on every WS/Breez signal. The SDK has NO cache:
 * every such read is replaced by a FRESH DB read through the existing repos
 * ({@link OrchestratorDeps}), resolved via the {@link OrchestratorWorkingSet} index
 * (protocol-quote-id → agicash-id). Getting this right is where double-spend / stale-proof /
 * missed-terminal would hide; each `step*` re-reads the DB and re-validates the current state
 * before acting, exactly mirroring the master hook's branch but without the cache.
 *
 * TWO ENTRY POINTS, ONE MACHINE.
 *  - The KICKOFF path (`executeCashuSendQuote` / `executeSparkSendQuote` / `start*Receive*`) takes
 *    the FULL object the caller already has, opens the live subscription/listener for it, and
 *    returns immediately (resolves on KICK-OFF). The terminal state arrives via `send:completed` /
 *    `send:failed` (+ a later `.get(id)`).
 *  - The `step*(signal)` methods are the manually-pumpable CORE: each takes a single external
 *    signal (a mint melt/mint-quote update, or a spark payment outcome), reads DB state, and runs
 *    the right service primitive through {@link runStep} (retry + verdict→error-model). They are
 *    what the live subscriptions call AND what the unit tests pump directly (NO live loop needed).
 *
 * The leader-gated autonomous PROCESSOR (the resume sweep that finds in-flight work in the DB and
 * pumps these same machines headless) is **Slice 5 / a later PR** — NOT built here. This slice
 * builds the machine CORE so it is reviewable + testable via direct kickoff + `step*`.
 *
 * @module
 */
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  type MintQuoteBolt11Response,
  MintQuoteState,
  type Proof,
} from '@cashu/cashu-ts';
import type { AccountRepository } from './account-repository';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type {
  CashuReceiveSwap,
  CashuReceiveSwapRepository,
} from './cashu-receive-swap-repository';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { CashuSendQuoteService } from './cashu-send-quote-service';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import type { CashuSendSwapService } from './cashu-send-swap-service';
import { type ExtendedCashuWallet, getCashuWallet } from './lib-cashu-wallet';
import { getCashuUnit } from './lib-cashu-quotes';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';
import { OrchestratorWorkingSet } from './orchestrator-working-set';
import { runStep } from './orchestrator-retry';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import type { SparkSendQuoteService } from './spark-send-quote-service';
import { ConcurrencyError, DomainError } from '../errors';
import type { TypedEventEmitter } from './event-emitter';
import type { SdkEventMap } from '../events';
import type { Account, CashuAccount, SparkAccount } from '../types/account';
import type { Currency, Money } from '../types/money';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
} from '../types/cashu';
import type { SparkReceiveQuote, SparkSendQuote } from '../types/spark';

/**
 * The SDK-internal collaborators the orchestrator drives. All are the SAME instances `Sdk.create`
 * builds for the public domains — the orchestrator shares them so a kickoff and the (future)
 * processor act on one source of truth (the DB + the live wallet handles).
 */
export type OrchestratorDeps = {
  accounts: AccountRepository;
  events: TypedEventEmitter<SdkEventMap>;
  cashuSendQuoteService: CashuSendQuoteService;
  cashuSendQuoteRepository: CashuSendQuoteRepository;
  cashuSendSwapService: CashuSendSwapService;
  cashuSendSwapRepository: CashuSendSwapRepository;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
  cashuReceiveSwapService: CashuReceiveSwapService;
  cashuReceiveSwapRepository: CashuReceiveSwapRepository;
  sparkSendQuoteService: SparkSendQuoteService;
  sparkSendQuoteRepository: SparkSendQuoteRepository;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
};

/**
 * The orchestrator. Holds the in-flight working-sets + the live subscription managers, and exposes
 * the kickoff methods (called by the public domains) + the manually-pumpable `step*` cores (called
 * by the subscriptions and by tests).
 */
export class Orchestrator {
  /** cashu SEND-quote in-flight index (melt-quote-id → agicash send-quote id). */
  private readonly cashuSendSet = new OrchestratorWorkingSet();
  /** cashu RECEIVE-quote in-flight index (mint-quote-id → agicash receive-quote id, LIGHTNING). */
  private readonly cashuReceiveSet = new OrchestratorWorkingSet();
  /** cashu cross-account token-receive in-flight index (melt-quote-id → agicash receive-quote id). */
  private readonly cashuTokenReceiveSet = new OrchestratorWorkingSet();
  /** spark cross-account token-receive in-flight index (melt-quote-id → agicash spark-receive id). */
  private readonly sparkTokenReceiveSet = new OrchestratorWorkingSet();

  /** Mint melt-quote WS manager (cashu sends + cross-account token receives), wallet factory injected. */
  private readonly meltSubscriptions: MeltQuoteSubscriptionManager;
  /** Mint mint-quote WS manager (cashu lightning receives), wallet factory injected. */
  private readonly mintSubscriptions: MintQuoteSubscriptionManager;

  /**
   * @param deps - the SDK-internal collaborators to drive.
   * @param subscriptions - the live mint-WS managers (injectable for tests). Default: real managers
   *   over a bare `getCashuWallet(mintUrl)` factory — sufficient for the WS protocol (subscriptions
   *   only need the mint socket, not loaded keysets); state-changing steps fetch the FULL account
   *   (keyset-loaded `ExtendedCashuWallet`) from the DB before acting.
   */
  constructor(
    private readonly deps: OrchestratorDeps,
    subscriptions?: {
      melt: MeltQuoteSubscriptionManager;
      mint: MintQuoteSubscriptionManager;
    },
  ) {
    this.meltSubscriptions =
      subscriptions?.melt ??
      new MeltQuoteSubscriptionManager((mintUrl) => getCashuWallet(mintUrl));
    this.mintSubscriptions =
      subscriptions?.mint ??
      new MintQuoteSubscriptionManager((mintUrl) => getCashuWallet(mintUrl));
  }

  // ===========================================================================================
  // CASHU lightning SEND — drives UNPAID → PENDING → PAID off the mint melt-quote WS.
  // Source: send/cashu-send-quote-hooks.ts#useProcessCashuSendQuoteTasks (+ useOnMeltQuoteStateChange).
  // ===========================================================================================

  /**
   * KICKOFF a cashu lightning send. Registers the quote in the in-flight index, opens the melt-quote
   * WS subscription for its mint (which will pump {@link stepCashuSendQuote} on each update), and
   * returns the quote in its current state. Terminal arrives via `send:completed` / `send:failed`.
   *
   * @param quote - the FULL send quote (UNPAID on kickoff).
   * @returns the same quote (resolves on kick-off; does NOT block until terminal).
   */
  async executeCashuSendQuote(quote: CashuSendQuote): Promise<CashuSendQuote> {
    if (quote.state !== 'UNPAID' && quote.state !== 'PENDING') {
      // Nothing to drive — already terminal.
      return quote;
    }
    const account = await this.requireCashuAccount(quote.accountId);
    this.cashuSendSet.track({
      protocolId: quote.quoteId,
      agicashId: quote.id,
      mintUrl: account.mintUrl,
    });
    await this.trySubscribeMelt({
      mintUrl: account.mintUrl,
      quoteIds: [quote.quoteId],
      onUpdate: (meltQuote) => {
        void this.stepCashuSendQuote(meltQuote);
      },
    });
    return quote;
  }

  /**
   * STEP the cashu send machine on a melt-quote update. Manually pumpable (the unit tests call this
   * directly). Resolves the agicash send quote from the in-flight index → reads FRESH DB state →
   * branches on the melt state exactly as master's `useOnMeltQuoteStateChange` does
   * (`onUnpaid`→initiate, `onPending`→markPending, `onPaid`→complete, `onExpired`→expire), each
   * through {@link runStep}.
   *
   * @param meltQuote - the mint's melt-quote update.
   */
  async stepCashuSendQuote(meltQuote: MeltQuoteBolt11Response): Promise<void> {
    const tracked = this.cashuSendSet.getByProtocolId(meltQuote.quote);
    if (!tracked) {
      return;
    }
    // DB-READ (not cache): the authoritative current state of the send quote.
    const sendQuote = await this.deps.cashuSendQuoteRepository.get(
      tracked.agicashId,
    );
    if (!sendQuote || this.isCashuSendTerminal(sendQuote)) {
      // Removed / completed / failed in the meantime — stop tracking.
      this.cashuSendSet.untrackByAgicashId(tracked.agicashId);
      return;
    }
    const account = await this.requireCashuAccount(sendQuote.accountId);

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      // The mint flips the melt quote back to UNPAID on a failed payment; only (re-)initiate while
      // OUR quote is also UNPAID (an already-initiated send must not be re-sent). Master verbatim.
      if (sendQuote.state === 'UNPAID') {
        await this.initiateCashuSend(account, sendQuote, meltQuote);
      }
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      await runStep(() =>
        this.deps.cashuSendQuoteService.markSendQuoteAsPending(sendQuote),
      );
    } else if (meltQuote.state === MeltQuoteState.PAID) {
      await this.completeCashuSend(account, sendQuote, meltQuote);
    }
  }

  /**
   * Initiate the send (mint melt-proofs), failing the quote on a `MintOperationError` exactly as
   * master's `initiateSend` mutation does (`onError` → `failSendQuote`). The `already-resolved`
   * verdict (the melt already happened) is a no-op — the PENDING/PAID WS update will complete it.
   */
  private async initiateCashuSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    try {
      const outcome = await runStep(() =>
        this.deps.cashuSendQuoteService.initiateSend(
          account,
          sendQuote,
          meltQuote,
        ),
      );
      if (outcome.kind === 'already-resolved') {
        // The melt already happened (idempotent re-issue) — the completion path picks it up.
        return;
      }
    } catch (error) {
      // A permanent rejection (→ DomainError) means the mint will never accept this send. Master
      // fails the quote in that case so the user can retry; mirror that here. A transient failure
      // (→ ConcurrencyError) is left for the next signal / resume sweep.
      if (error instanceof DomainError) {
        await this.failCashuSendQuote(account, sendQuote, error.message);
        return;
      }
      // ConcurrencyError / anything else — surface so the caller (kickoff) or processor retries.
      throw error;
    }
  }

  /** Complete the send (derive + match NUT-08 change), emit `send:completed`, stop tracking. */
  private async completeCashuSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const outcome = await runStep(() =>
      this.deps.cashuSendQuoteService.completeSendQuote(
        account,
        sendQuote,
        meltQuote,
      ),
    );
    // The completion is terminal either way (resolved OR already-resolved-by-restore).
    const completed =
      outcome.kind === 'resolved'
        ? outcome.value
        : await this.deps.cashuSendQuoteRepository.get(sendQuote.id);
    this.cashuSendSet.untrackByAgicashId(sendQuote.id);
    this.meltSubscriptions.removeQuoteFromSubscription({
      mintUrl: account.mintUrl,
      quoteId: sendQuote.quoteId,
    });
    if (completed && completed.state === 'PAID') {
      this.deps.events.emit('send:completed', {
        quoteId: completed.id,
        transactionId: completed.transactionId,
        amount: completed.amountReceived,
        protocol: 'cashu',
      });
    }
  }

  /** Fail the send quote, emit `send:failed`, stop tracking + drop the WS subscription for it. */
  private async failCashuSendQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    reason: string,
  ): Promise<void> {
    await runStep(() =>
      this.deps.cashuSendQuoteService.failSendQuote(account, sendQuote, reason),
    );
    this.cashuSendSet.untrackByAgicashId(sendQuote.id);
    this.meltSubscriptions.removeQuoteFromSubscription({
      mintUrl: account.mintUrl,
      quoteId: sendQuote.quoteId,
    });
    this.deps.events.emit('send:failed', {
      quoteId: sendQuote.id,
      error: new DomainError(reason),
      protocol: 'cashu',
    });
  }

  private isCashuSendTerminal(quote: CashuSendQuote): boolean {
    return (
      quote.state === 'PAID' ||
      quote.state === 'FAILED' ||
      quote.state === 'EXPIRED'
    );
  }

  // ===========================================================================================
  // CASHU token SEND (swap) — drives DRAFT → PENDING → COMPLETED.
  // Source: send/cashu-send-swap-hooks.ts#useProcessCashuSendSwapTasks (proof-state sub + draft trigger).
  // ===========================================================================================

  /**
   * KICKOFF / advance a cashu token send. A DRAFT swap is swapped for the exact proofs-to-send
   * (→ PENDING); a PENDING swap is left for its proofs to be spent (the proof-state watcher /
   * resume sweep completes it). Returns the swap in its current state. Master's hook does the DRAFT
   * swap via a trigger query + completes on proof-spent.
   *
   * @param swap - the FULL token-send swap.
   * @returns the swap (PENDING after a DRAFT swap, else unchanged).
   */
  async executeCashuSendSwap(swap: CashuSendSwap): Promise<CashuSendSwap> {
    if (swap.state === 'DRAFT') {
      return this.stepCashuSendSwapDraft(swap);
    }
    // PENDING swaps complete when their proofs are detected spent (proof-state subscription /
    // resume sweep) — nothing to kick off here.
    return swap;
  }

  /**
   * STEP a DRAFT token-send swap → swap input proofs for proofs-to-send (→ PENDING). Reads FRESH
   * DB state first. Manually pumpable.
   *
   * @param swap - the swap to advance (re-read from the DB).
   * @returns the (re-read) swap after the step.
   */
  async stepCashuSendSwapDraft(swap: CashuSendSwap): Promise<CashuSendSwap> {
    const fresh = await this.deps.cashuSendSwapRepository.get(swap.id);
    if (!fresh || fresh.state !== 'DRAFT') {
      return fresh ?? swap;
    }
    const account = await this.requireCashuAccount(fresh.accountId);
    await runStep(() =>
      this.deps.cashuSendSwapService.swapForProofsToSend({
        account,
        swap: fresh,
      }),
    );
    return (await this.deps.cashuSendSwapRepository.get(swap.id)) ?? fresh;
  }

  /**
   * STEP a PENDING token-send swap → mark COMPLETED (called when its proofs are detected spent).
   * Reads FRESH DB state, emits `send:completed`. Manually pumpable.
   *
   * @param swapId - the agicash swap id whose proofs were spent.
   */
  async stepCashuSendSwapSpent(swapId: string): Promise<void> {
    const swap = await this.deps.cashuSendSwapRepository.get(swapId);
    if (!swap || swap.state !== 'PENDING') {
      return;
    }
    const outcome = await runStep(() =>
      this.deps.cashuSendSwapService.complete(swap),
    );
    if (outcome.kind === 'resolved' || outcome.kind === 'already-resolved') {
      this.deps.events.emit('send:completed', {
        quoteId: swap.id,
        transactionId: swap.transactionId,
        amount: swap.amountReceived,
        protocol: 'cashu',
      });
    }
  }

  // ===========================================================================================
  // SPARK lightning SEND — drives UNPAID → PENDING → COMPLETED/FAILED off Breez sendPayment + events.
  // Source: send/spark-send-quote-hooks.ts#useProcessSparkSendQuoteTasks (+ useOnSparkSendStateChange).
  // ===========================================================================================

  /**
   * KICKOFF a spark lightning send. An UNPAID quote is initiated immediately (Breez `sendPayment`,
   * UNPAID → PENDING). The TERMINAL transition (→ COMPLETED / FAILED) is driven by the account's
   * Breez `paymentSucceeded` / `paymentFailed` event — surfaced to the orchestrator via
   * {@link stepSparkSendCompleted} / {@link stepSparkSendFailed} (the S5 spark-event substrate +
   * the balance tracker share this listener). Returns the quote in its (possibly now PENDING) state.
   *
   * @param quote - the FULL spark send quote (UNPAID on kickoff).
   * @returns the quote after initiation (PENDING) or unchanged if already past UNPAID.
   */
  async executeSparkSendQuote(quote: SparkSendQuote): Promise<SparkSendQuote> {
    if (quote.state !== 'UNPAID') {
      return quote;
    }
    const account = await this.requireSparkAccount(quote.accountId);
    try {
      const outcome = await runStep(() =>
        this.deps.sparkSendQuoteService.initiateSend({
          account,
          sendQuote: quote,
        }),
      );
      if (outcome.kind === 'resolved' && outcome.value) {
        this.deps.events.emit('send:pending', {
          quoteId: outcome.value.id,
          transactionId: outcome.value.transactionId,
          protocol: 'spark',
        });
        return outcome.value;
      }
      return quote;
    } catch (error) {
      // Master fails the quote on a DomainError from `initiateSend` (invoice already paid / fee
      // changed / insufficient) so the user can retry; mirror that.
      if (error instanceof DomainError) {
        await this.failSparkSendQuote(quote, error.message);
        return quote;
      }
      throw error;
    }
  }

  /**
   * STEP a spark send to COMPLETED on a Breez `paymentSucceeded`. Reads FRESH DB state, emits
   * `send:completed`. Manually pumpable.
   *
   * @param params.quoteId - the agicash spark send-quote id.
   * @param params.paymentPreimage - the lightning preimage from the Breez payment.
   */
  async stepSparkSendCompleted(params: {
    quoteId: string;
    paymentPreimage: string;
  }): Promise<void> {
    const quote = await this.deps.sparkSendQuoteRepository.get(params.quoteId);
    if (!quote || quote.state !== 'PENDING') {
      return;
    }
    const outcome = await runStep(() =>
      this.deps.sparkSendQuoteService.complete(quote, params.paymentPreimage),
    );
    if (outcome.kind === 'resolved' || outcome.kind === 'already-resolved') {
      this.deps.events.emit('send:completed', {
        quoteId: quote.id,
        transactionId: quote.transactionId,
        amount: quote.amount,
        protocol: 'spark',
      });
    }
  }

  /**
   * STEP a spark send to FAILED on a Breez `paymentFailed` (or initiation DomainError). Reads FRESH
   * DB state, emits `send:failed`. Manually pumpable.
   *
   * @param params.quoteId - the agicash spark send-quote id.
   * @param params.reason - the failure reason.
   */
  async stepSparkSendFailed(params: {
    quoteId: string;
    reason: string;
  }): Promise<void> {
    const quote = await this.deps.sparkSendQuoteRepository.get(params.quoteId);
    if (!quote || (quote.state !== 'PENDING' && quote.state !== 'UNPAID')) {
      return;
    }
    await this.failSparkSendQuote(quote, params.reason);
  }

  /** Fail the spark send quote + emit `send:failed`. */
  private async failSparkSendQuote(
    quote: SparkSendQuote,
    reason: string,
  ): Promise<void> {
    await runStep(() => this.deps.sparkSendQuoteService.fail(quote, reason));
    this.deps.events.emit('send:failed', {
      quoteId: quote.id,
      error: new DomainError(reason),
      protocol: 'spark',
    });
  }

  // ===========================================================================================
  // CASHU lightning RECEIVE — drives UNPAID → PAID → COMPLETED off the mint mint-quote WS / poll.
  // Source: receive/cashu-receive-quote-hooks.ts#useProcessCashuReceiveQuoteTasks (LIGHTNING branch).
  // ===========================================================================================

  /**
   * START tracking a cashu lightning receive quote: register it in the in-flight index + open the
   * mint-quote WS subscription for its mint (which pumps {@link stepCashuReceiveQuote} on each
   * update). Returns the quote in its current state; `receive:completed` / `receive:expired` arrive
   * via the subscription. (For mints without WebSocket support master polls; the leader-gated
   * processor poll is Slice 5 — here the WS path + manual `step*` cover the testable core.)
   *
   * @param quote - the FULL receive quote (UNPAID on creation).
   * @returns the same quote (resolves on start).
   */
  async startCashuReceiveQuote(
    quote: CashuReceiveQuote,
  ): Promise<CashuReceiveQuote> {
    if (quote.type !== 'LIGHTNING' || this.isCashuReceiveTerminal(quote)) {
      return quote;
    }
    const account = await this.requireCashuAccount(quote.accountId);
    this.cashuReceiveSet.track({
      protocolId: quote.quoteId,
      agicashId: quote.id,
      mintUrl: account.mintUrl,
    });
    await this.trySubscribeMint({
      mintUrl: account.mintUrl,
      quoteIds: [quote.quoteId],
      onUpdate: (mintQuote) => {
        void this.stepCashuReceiveQuote(mintQuote);
      },
    });
    return quote;
  }

  /**
   * STEP the cashu LIGHTNING receive machine on a mint-quote update. Manually pumpable. Resolves
   * the agicash receive quote from the in-flight index → reads FRESH DB state → branches on the
   * mint state as master's `useOnMintQuoteStateChange` does (PAID/ISSUED→complete-receive,
   * UNPAID+expired→expire).
   *
   * @param mintQuote - the mint's mint-quote update.
   */
  async stepCashuReceiveQuote(
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    const tracked = this.cashuReceiveSet.getByProtocolId(mintQuote.quote);
    if (!tracked) {
      return;
    }
    const quote = await this.deps.cashuReceiveQuoteRepository.get(
      tracked.agicashId,
    );
    if (!quote || this.isCashuReceiveTerminal(quote)) {
      this.cashuReceiveSet.untrackByAgicashId(tracked.agicashId);
      return;
    }
    const account = await this.requireCashuAccount(quote.accountId);

    if (
      mintQuote.state === MintQuoteState.PAID ||
      mintQuote.state === MintQuoteState.ISSUED
    ) {
      // ISSUED → master re-runs complete in case the COMPLETED transition failed after minting
      // (e.g. the browser was killed); `completeReceive` is idempotent.
      await this.completeCashuReceive(account, quote);
    } else if (
      mintQuote.state === MintQuoteState.UNPAID &&
      new Date(quote.expiresAt) < new Date()
    ) {
      await runStep(() => this.deps.cashuReceiveQuoteService.expire(quote));
      this.emitCashuReceiveExpired(quote.id);
      this.cashuReceiveSet.untrackByAgicashId(quote.id);
    }
  }

  /** Complete the cashu receive (mint proofs + credit), emit `receive:completed`, stop tracking. */
  private async completeCashuReceive(
    account: CashuAccount,
    quote: CashuReceiveQuote,
  ): Promise<void> {
    const outcome = await runStep(() =>
      this.deps.cashuReceiveQuoteService.completeReceive(account, quote),
    );
    const completedQuote =
      outcome.kind === 'resolved'
        ? outcome.value.quote
        : await this.deps.cashuReceiveQuoteRepository.get(quote.id);
    this.cashuReceiveSet.untrackByAgicashId(quote.id);
    // A cross-account CASHU_TOKEN destination is also tracked on the source-melt index; drop it too
    // (the source melt is PAID by completion time, so its WS will not fire a terminal again).
    this.cashuTokenReceiveSet.untrackByAgicashId(quote.id);
    if (completedQuote && completedQuote.state === 'COMPLETED') {
      this.deps.events.emit('receive:completed', {
        quoteId: completedQuote.id,
        transactionId: completedQuote.transactionId,
        amount: completedQuote.amount,
        protocol: 'cashu',
      });
    }
  }

  private emitCashuReceiveExpired(quoteId: string): void {
    this.deps.events.emit('receive:expired', {
      quoteId,
      protocol: 'cashu',
    });
  }

  private isCashuReceiveTerminal(quote: CashuReceiveQuote): boolean {
    return (
      quote.state === 'COMPLETED' ||
      quote.state === 'EXPIRED' ||
      quote.state === 'FAILED'
    );
  }

  // ===========================================================================================
  // CASHU same-mint token RECEIVE (swap) — drives PENDING → COMPLETED off proof-state / kickoff.
  // Source: receive/cashu-receive-swap-hooks.ts#useProcessCashuReceiveSwapTasks.
  // ===========================================================================================

  /**
   * STEP a same-mint cashu receive swap → COMPLETE it (execute the mint swap + store proofs).
   * Reads FRESH DB state, emits `receive:completed` (or `receive:failed` if the token was already
   * claimed — the service fails the swap in that case). Manually pumpable; also called inline by
   * {@link receiveTokenSameMint}.
   *
   * @param tokenHash - the swap's token hash (the receive-swap's id key).
   * @param userId - the owning user (the receive-swap repo keys on tokenHash+userId).
   */
  async stepCashuReceiveSwap(tokenHash: string, userId: string): Promise<void> {
    const swap = await this.findPendingReceiveSwap(tokenHash, userId);
    if (!swap || swap.state !== 'PENDING') {
      return;
    }
    const account = await this.requireCashuAccount(swap.accountId);
    const outcome = await runStep(() =>
      this.deps.cashuReceiveSwapService.completeSwap(account, swap),
    );
    if (outcome.kind === 'already-resolved') {
      return;
    }
    if (outcome.kind === 'resolved') {
      const resultSwap = outcome.value.swap;
      if (resultSwap.state === 'COMPLETED') {
        this.deps.events.emit('receive:completed', {
          quoteId: resultSwap.transactionId,
          transactionId: resultSwap.transactionId,
          amount: resultSwap.amountReceived,
          protocol: 'cashu',
        });
      } else if (resultSwap.state === 'FAILED') {
        this.deps.events.emit('receive:failed', {
          quoteId: resultSwap.transactionId,
          error: new DomainError(
            resultSwap.failureReason ?? 'Token already claimed',
          ),
          protocol: 'cashu',
        });
      }
    }
  }

  /** Find a PENDING receive swap by token hash (DB read via the repo's pending query). */
  private async findPendingReceiveSwap(
    tokenHash: string,
    userId: string,
  ): Promise<CashuReceiveSwap | undefined> {
    const pending =
      await this.deps.cashuReceiveSwapRepository.getPending(userId);
    return pending.find((s) => s.tokenHash === tokenHash);
  }

  // ===========================================================================================
  // CROSS-ACCOUNT token RECEIVE (cashu + spark destinations) — drives the melt off the melt-quote WS.
  // Source: receive/{cashu,spark}-receive-quote-hooks.ts (the CASHU_TOKEN melt branch).
  // ===========================================================================================

  /**
   * START tracking a cross-account CASHU_TOKEN cashu receive quote (token → a DIFFERENT cashu mint).
   * Registers it on the melt-quote index + opens the source-mint melt-quote WS subscription (which
   * pumps {@link stepCashuTokenReceiveMelt}). The melt of the source token funds the destination
   * mint quote; once the melt is PAID the destination receive is completed.
   *
   * @param quote - the CASHU_TOKEN cashu receive quote (UNPAID).
   * @returns the quote unchanged (resolves on start).
   */
  async startCashuTokenReceiveQuote(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<CashuReceiveQuote> {
    if (this.isCashuReceiveTerminal(quote)) {
      return quote;
    }
    const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
    this.cashuTokenReceiveSet.track({
      protocolId: quote.tokenReceiveData.meltQuoteId,
      agicashId: quote.id,
      mintUrl: sourceMintUrl,
    });
    await this.trySubscribeMelt({
      mintUrl: sourceMintUrl,
      quoteIds: [quote.tokenReceiveData.meltQuoteId],
      onUpdate: (meltQuote) => {
        void this.stepCashuTokenReceiveMelt(meltQuote);
      },
    });
    // The mint quote on the DESTINATION mint is tracked separately so its PAID update completes the
    // destination receive (the same path as a plain lightning receive).
    await this.startCashuReceiveQuoteForToken(quote);
    return quote;
  }

  /** Track the DESTINATION mint quote of a cross-account cashu-token receive (completes it on PAID). */
  private async startCashuReceiveQuoteForToken(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<void> {
    const account = await this.requireCashuAccount(quote.accountId);
    this.cashuReceiveSet.track({
      protocolId: quote.quoteId,
      agicashId: quote.id,
      mintUrl: account.mintUrl,
    });
    await this.trySubscribeMint({
      mintUrl: account.mintUrl,
      quoteIds: [quote.quoteId],
      onUpdate: (mintQuote) => {
        void this.stepCashuReceiveQuote(mintQuote);
      },
    });
  }

  /**
   * STEP the cross-account CASHU cashu-token melt on a SOURCE-mint melt-quote update. Manually
   * pumpable. Branches as master's CASHU_TOKEN `useOnMeltQuoteStateChange` does: UNPAID→initiate
   * the melt (or fail if it was already initiated, meaning the melt failed), PENDING→mark melt
   * initiated, EXPIRED→expire.
   *
   * @param meltQuote - the source mint's melt-quote update.
   */
  async stepCashuTokenReceiveMelt(
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const tracked = this.cashuTokenReceiveSet.getByProtocolId(meltQuote.quote);
    if (!tracked) {
      return;
    }
    const quote = await this.deps.cashuReceiveQuoteRepository.get(
      tracked.agicashId,
    );
    if (
      !quote ||
      quote.type !== 'CASHU_TOKEN' ||
      this.isCashuReceiveTerminal(quote)
    ) {
      this.cashuTokenReceiveSet.untrackByAgicashId(tracked.agicashId);
      return;
    }
    await this.driveTokenMelt({
      meltQuote,
      sourceMintUrl: quote.tokenReceiveData.sourceMintUrl,
      tokenAmountCurrency: quote.tokenReceiveData.tokenAmount.currency,
      meltInitiated: quote.tokenReceiveData.meltInitiated,
      tokenProofs: quote.tokenReceiveData.tokenProofs,
      meltQuoteId: quote.tokenReceiveData.meltQuoteId,
      amount: quote.amount,
      markMeltInitiated: () =>
        this.deps.cashuReceiveQuoteService.markMeltInitiated(quote),
      fail: (reason) => this.deps.cashuReceiveQuoteService.fail(quote, reason),
      expire: () => this.deps.cashuReceiveQuoteService.expire(quote),
      onExpired: () => {
        this.emitCashuReceiveExpired(quote.id);
        this.cashuTokenReceiveSet.untrackByAgicashId(quote.id);
      },
    });
  }

  /**
   * START tracking a cross-account CASHU_TOKEN SPARK receive quote (token → spark). Same source-mint
   * melt machine as the cashu cross-account path; the destination is a spark receive completed by
   * the Breez listener (the kickoff `receiveTokenToSpark` waits for it inline).
   *
   * @param quote - the CASHU_TOKEN spark receive quote (UNPAID).
   * @returns the quote unchanged (resolves on start).
   */
  async startSparkTokenReceiveQuote(
    quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<SparkReceiveQuote> {
    if (quote.state !== 'UNPAID') {
      return quote;
    }
    const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
    this.sparkTokenReceiveSet.track({
      protocolId: quote.tokenReceiveData.meltQuoteId,
      agicashId: quote.id,
      mintUrl: sourceMintUrl,
    });
    await this.trySubscribeMelt({
      mintUrl: sourceMintUrl,
      quoteIds: [quote.tokenReceiveData.meltQuoteId],
      onUpdate: (meltQuote) => {
        void this.stepSparkTokenReceiveMelt(meltQuote);
      },
    });
    return quote;
  }

  /**
   * STEP the cross-account SPARK cashu-token melt on a SOURCE-mint melt-quote update. Manually
   * pumpable. Same branch logic as {@link stepCashuTokenReceiveMelt} but over the spark
   * receive-quote service.
   *
   * @param meltQuote - the source mint's melt-quote update.
   */
  async stepSparkTokenReceiveMelt(
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const tracked = this.sparkTokenReceiveSet.getByProtocolId(meltQuote.quote);
    if (!tracked) {
      return;
    }
    const quote = await this.deps.sparkReceiveQuoteRepository.get(
      tracked.agicashId,
    );
    if (!quote || quote.type !== 'CASHU_TOKEN' || quote.state !== 'UNPAID') {
      this.sparkTokenReceiveSet.untrackByAgicashId(tracked.agicashId);
      return;
    }
    await this.driveTokenMelt({
      meltQuote,
      sourceMintUrl: quote.tokenReceiveData.sourceMintUrl,
      tokenAmountCurrency: quote.tokenReceiveData.tokenAmount.currency,
      meltInitiated: quote.tokenReceiveData.meltInitiated,
      tokenProofs: quote.tokenReceiveData.tokenProofs,
      meltQuoteId: quote.tokenReceiveData.meltQuoteId,
      amount: quote.amount,
      markMeltInitiated: () =>
        this.deps.sparkReceiveQuoteService.markMeltInitiated(quote),
      fail: (reason) => this.deps.sparkReceiveQuoteService.fail(quote, reason),
      expire: () => this.deps.sparkReceiveQuoteService.expire(quote),
      onExpired: () => {
        this.deps.events.emit('receive:expired', {
          quoteId: quote.id,
          protocol: 'spark',
        });
        this.sparkTokenReceiveSet.untrackByAgicashId(quote.id);
      },
    });
  }

  /**
   * The shared cross-account token-melt drive logic (cashu + spark destinations), parameterised by
   * the destination's receive-quote service callbacks. Master duplicates this branch across the two
   * receive hooks; the orchestrator factors it once (the melt itself is identical — it is always a
   * SOURCE-mint melt; only the destination service differs).
   */
  private async driveTokenMelt(params: {
    meltQuote: MeltQuoteBolt11Response;
    sourceMintUrl: string;
    tokenAmountCurrency: Currency;
    meltInitiated: boolean;
    tokenProofs: Proof[];
    meltQuoteId: string;
    amount: Money;
    markMeltInitiated: () => Promise<unknown>;
    fail: (reason: string) => Promise<void>;
    expire: () => Promise<void>;
    onExpired: () => void;
  }): Promise<void> {
    const { meltQuote } = params;
    // The melt-quote WS reports only UNPAID/PENDING/PAID (no EXPIRED state); expiry is detected by
    // a past-expiry UNPAID re-report, matching master's expiry-timer effect.
    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (new Date() > new Date(meltQuote.expiry * 1000)) {
        await runStep(() => params.expire());
        params.onExpired();
        return;
      }
      if (params.meltInitiated) {
        // Melt was initiated but is UNPAID again ⇒ the melt FAILED. Fail the receive quote.
        await runStep(() => params.fail('Cashu token melt failed.'));
        return;
      }
      await this.initiateTokenMelt(params);
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      await runStep(() => params.markMeltInitiated());
    }
    // PAID → the destination mint/spark quote completion is driven by its own mint-quote WS /
    // Breez event (tracked separately at kickoff); nothing to do on the SOURCE melt here.
  }

  /** Initiate the source-token melt (idempotent, random change outputs); fail the receive on a permanent rejection. */
  private async initiateTokenMelt(params: {
    sourceMintUrl: string;
    tokenAmountCurrency: Currency;
    tokenProofs: Proof[];
    meltQuoteId: string;
    amount: Money;
    fail: (reason: string) => Promise<void>;
  }): Promise<void> {
    const cashuUnit = getCashuUnit(params.tokenAmountCurrency);
    // Resolve the source wallet: the orchestrator's WS factory gives a bare mint wallet; the melt
    // needs the source mint's keysets, so build a wallet for it. Master uses the account wallet if
    // the user has one, else `getInitializedCashuWallet`. Here the source is, by construction, a
    // mint the user need not have an account for — use the WS-factory wallet, which cashu-ts lazily
    // loads keysets for on the melt call.
    const sourceWallet: ExtendedCashuWallet = getCashuWallet(
      params.sourceMintUrl,
    );
    try {
      await runStep(() =>
        sourceWallet.meltProofsIdempotent(
          {
            quote: params.meltQuoteId,
            amount: params.amount.toNumber(cashuUnit),
          },
          params.tokenProofs,
          undefined,
          // Random change outputs (no deterministic counter collision); change is discarded.
          { type: 'random' },
        ),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        await params.fail(error.message);
        return;
      }
      throw error;
    }
  }

  // ===========================================================================================
  // SPARK lightning RECEIVE — completed off the Breez paymentSucceeded event.
  // Source: receive/spark-receive-quote-hooks.ts#useProcessSparkReceiveQuoteTasks (LIGHTNING branch).
  // ===========================================================================================

  /**
   * STEP a spark LIGHTNING receive to PAID on a Breez `paymentSucceeded`. Reads FRESH DB state,
   * emits `receive:completed`. Manually pumpable (the S5 spark-event substrate calls it).
   *
   * @param params.quoteId - the agicash spark receive-quote id.
   * @param params.paymentPreimage - the lightning preimage.
   * @param params.sparkTransferId - the Breez payment/transfer id.
   */
  async stepSparkReceiveCompleted(params: {
    quoteId: string;
    paymentPreimage: string;
    sparkTransferId: string;
  }): Promise<void> {
    const quote = await this.deps.sparkReceiveQuoteRepository.get(
      params.quoteId,
    );
    if (!quote || quote.state !== 'UNPAID') {
      return;
    }
    const outcome = await runStep(() =>
      this.deps.sparkReceiveQuoteService.complete(
        quote,
        params.paymentPreimage,
        params.sparkTransferId,
      ),
    );
    if (outcome.kind === 'resolved' || outcome.kind === 'already-resolved') {
      this.deps.events.emit('receive:completed', {
        quoteId: quote.id,
        transactionId: quote.transactionId,
        amount: quote.amount,
        protocol: 'spark',
      });
    }
  }

  /**
   * STEP a spark receive to EXPIRED (Breez `synced` + past-expiry). Reads FRESH DB state, emits
   * `receive:expired`. Manually pumpable.
   *
   * @param quoteId - the agicash spark receive-quote id.
   */
  async stepSparkReceiveExpired(quoteId: string): Promise<void> {
    const quote = await this.deps.sparkReceiveQuoteRepository.get(quoteId);
    if (!quote || quote.state !== 'UNPAID') {
      return;
    }
    await runStep(() => this.deps.sparkReceiveQuoteService.expire(quote));
    this.deps.events.emit('receive:expired', {
      quoteId: quote.id,
      protocol: 'spark',
    });
  }

  // ===========================================================================================
  // Lifecycle + shared helpers
  // ===========================================================================================

  /** Tear down all live subscriptions + clear the in-flight indices (called from `Sdk.destroy()`). */
  async destroy(): Promise<void> {
    this.cashuSendSet.clear();
    this.cashuReceiveSet.clear();
    this.cashuTokenReceiveSet.clear();
    this.sparkTokenReceiveSet.clear();
    await Promise.all([
      this.meltSubscriptions.closeAll(),
      this.mintSubscriptions.closeAll(),
    ]);
  }

  /**
   * Open a melt-quote WS subscription, swallowing a connect failure (logged). The quote is already
   * persisted, so a transient mint-WS outage must NOT fail the kickoff — the (Slice-5) resume sweep
   * re-establishes the subscription. Master's `useOnMeltQuoteStateChange` similarly retries the
   * subscribe mutation rather than propagating.
   */
  private async trySubscribeMelt(params: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (meltQuote: MeltQuoteBolt11Response) => void;
  }): Promise<void> {
    try {
      await this.meltSubscriptions.subscribe(params);
    } catch (error) {
      console.warn('Failed to open melt-quote subscription', {
        mintUrl: params.mintUrl,
        cause: error,
      });
    }
  }

  /** Open a mint-quote WS subscription, swallowing a connect failure (logged). See {@link trySubscribeMelt}. */
  private async trySubscribeMint(params: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (mintQuote: MintQuoteBolt11Response) => void;
  }): Promise<void> {
    try {
      await this.mintSubscriptions.subscribe(params);
    } catch (error) {
      console.warn('Failed to open mint-quote subscription', {
        mintUrl: params.mintUrl,
        cause: error,
      });
    }
  }

  /** Fetch + assert a live cashu account (with its keyset-loaded wallet + decrypted proofs). */
  private async requireCashuAccount(id: string): Promise<CashuAccount> {
    const account = await this.deps.accounts.get(id);
    if (!account || account.type !== 'cashu') {
      throw new ConcurrencyError(`Cashu account not found for id: ${id}`);
    }
    return account;
  }

  /** Fetch + assert a live spark account (with its connected Breez wallet). */
  private async requireSparkAccount(id: string): Promise<SparkAccount> {
    const account: Account | null = await this.deps.accounts.get(id);
    if (!account || account.type !== 'spark') {
      throw new ConcurrencyError(`Spark account not found for id: ${id}`);
    }
    return account;
  }
}
