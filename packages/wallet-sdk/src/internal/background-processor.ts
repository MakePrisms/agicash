/**
 * Background processor — Slice 5 / PR7. The `BackgroundDomain` engine.
 *
 * EXTRACTED (re-housed framework-free) from the two master constructs that drive autonomous wallet
 * work:
 *  - `apps/web-wallet/app/features/wallet/wallet.tsx` — the `{ isLead && <TaskProcessor/> }` gate +
 *    `useTrackWalletChanges()` (always-on realtime);
 *  - `wallet/task-processing.ts#TaskProcessor` — the six `useProcess*Tasks` hooks (each a DB resume
 *    sweep + a realtime/WS-triggered drive of one saga).
 *
 * The master `TaskProcessor` works by mounting six hooks; each hook (a) reads its unresolved/pending
 * rows from the DB on mount (the resume sweep), and (b) subscribes the realtime quote/swap CREATE
 * /UPDATE events + the mint-WS / Breez stream to drive in-flight work. The framework-free SDK has no
 * mount: this processor does the SAME two things explicitly. When this instance becomes leader it
 * runs a {@link resumeSweep} (enumerate unresolved/pending quotes+swaps FROM THE DB — the no-cache
 * "listPending" equivalent — and hand each to the orchestrator's kickoff, which opens its mint-WS
 * subscription / Breez listener and then auto-steps), and the realtime quote/swap events are routed
 * to the orchestrator to kick off work CREATED by any client. The account / transaction / contact
 * realtime changes are forwarded to the SDK's typed events ALWAYS (leadership-independent — the
 * consumer's read-model needs them whether or not this instance is the processor), exactly as
 * master keeps `useTrackWalletChanges` outside the `isLead` gate.
 *
 * THE NO-CACHE RULE (Josip, §0/§10): every read here is a FRESH DB read through the existing repos —
 * the processor holds no domain cache. The orchestrator's per-step machine (PR5d) already enforces
 * the same on each WS/Breez signal; this layer only adds the resume enumeration + the realtime
 * routing.
 *
 * Leadership is the {@link LeaderElection} timer loop over the lifted `take_lead` lock; this class
 * reacts to its transitions. The single `wallet:${userId}` channel is the {@link RealtimeHub}.
 *
 * @module
 */
import type { AccountRepository } from './account-repository';
import type { AccountEventForwarder } from './account-event-forwarder';
import type { ContactEventForwarder } from './contact-event-forwarder';
import type { LeadStatus, LeaderElection } from './leader-election';
import type { Orchestrator } from './orchestrator';
import type { RealtimeHub, BroadcastPayload } from './realtime-hub';
import type { SparkBalanceTracker } from './spark-balance-tracker';
import type { SparkEventForwarder } from './spark-event-forwarder';
import type { TransactionEventForwarder } from './transaction-event-forwarder';
import type { TypedEventEmitter } from './event-emitter';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import type { BackgroundState, SdkEventMap } from '../events';
import type { CashuReceiveQuote } from '../types/cashu';
import type { SparkAccount } from '../types/account';

/** The SDK-internal collaborators the background processor drives (all built by `Sdk.create`). */
export type BackgroundProcessorDeps = {
  events: TypedEventEmitter<SdkEventMap>;
  /** Resolve the signed-in user's id (the resume sweep + lock are per-user). null = signed out. */
  getUserId: () => Promise<string | null>;
  leaderElection: LeaderElection;
  realtimeHub: RealtimeHub;
  orchestrator: Orchestrator;
  /** Always-on realtime → SDK-event forwarders (consumer read-model). */
  accountEventForwarder: AccountEventForwarder;
  transactionEventForwarder: TransactionEventForwarder;
  contactEventForwarder: ContactEventForwarder;
  /** Leader-only spark substrates: balance source + the Breez terminal-event driver. */
  sparkBalanceTracker: SparkBalanceTracker;
  sparkEventForwarder: SparkEventForwarder;
  /** The repos the resume sweep enumerates unresolved/pending work from. */
  accounts: AccountRepository;
  cashuSendQuoteRepository: CashuSendQuoteRepository;
  cashuSendSwapRepository: CashuSendSwapRepository;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
  cashuReceiveSwapRepository: CashuReceiveSwapRepository;
  sparkSendQuoteRepository: SparkSendQuoteRepository;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
};

/** Realtime event names that drive the orchestrator (the leader resumes the work they announce). */
const QUOTE_SWAP_EVENTS = new Set([
  'CASHU_SEND_QUOTE_CREATED',
  'CASHU_SEND_QUOTE_UPDATED',
  'CASHU_SEND_SWAP_CREATED',
  'CASHU_SEND_SWAP_UPDATED',
  'CASHU_RECEIVE_QUOTE_CREATED',
  'CASHU_RECEIVE_QUOTE_UPDATED',
  'CASHU_RECEIVE_SWAP_CREATED',
  'CASHU_RECEIVE_SWAP_UPDATED',
  'SPARK_SEND_QUOTE_CREATED',
  'SPARK_SEND_QUOTE_UPDATED',
  'SPARK_RECEIVE_QUOTE_CREATED',
  'SPARK_RECEIVE_QUOTE_UPDATED',
]);

/**
 * Drives the leader-elected autonomous orchestrators + the always-on realtime event forwarding.
 * Framework-free; one instance per SDK, exposed through {@link BackgroundDomainImpl}.
 */
export class BackgroundProcessor {
  /** The lifecycle state (also surfaced via `background:state` + `BackgroundDomain.state()`). */
  private currentState: BackgroundState = 'stopped';

  constructor(private readonly deps: BackgroundProcessorDeps) {}

  /** The current lifecycle state (synchronous; backs `BackgroundDomain.state()`). */
  state(): BackgroundState {
    return this.currentState;
  }

  /**
   * Start background processing: subscribe the realtime channel (forwarders run regardless of
   * leadership) and begin lead-polling. Transitions `stopped` → `starting`; the first poll then
   * resolves to `follower` or `leader`. Idempotent — `start` while already running is a no-op.
   */
  async start(): Promise<void> {
    if (this.currentState !== 'stopped') {
      return;
    }
    this.setState('starting');

    // The single realtime channel is leadership-INDEPENDENT (the consumer's read-model needs
    // account/transaction/contact events whether or not we are the processor) — subscribe it now.
    const userId = await this.deps.getUserId();
    if (userId) {
      this.deps.realtimeHub.subscribe(userId);
    }

    // Begin the lead poll; `onChange` (wired in `Sdk.create`) flips us follower↔leader.
    this.deps.leaderElection.start();
  }

  /**
   * Stop background processing: stop lead-polling, unsubscribe realtime, and tear down the leader's
   * spark listeners. In-flight orchestrator steps already started run to completion (they own no
   * timer here); the orchestrator's mint-WS subscriptions are closed in `Sdk.destroy()`, not here
   * (`stop` is pause-able — a later `start` re-subscribes + re-sweeps). Transitions to `stopping`
   * then `stopped`. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') {
      return;
    }
    this.setState('stopping');
    this.deps.leaderElection.stop();
    this.deps.sparkBalanceTracker.stop();
    this.deps.sparkEventForwarder.stop();
    await this.deps.realtimeHub.stop();
    this.setState('stopped');
  }

  /**
   * React to a leadership transition (wired to {@link LeaderElection} `onChange`). Becoming leader
   * runs the resume sweep + starts the spark substrates; becoming follower tears the spark
   * substrates down (we no longer drive). No-op while not running (a late poll after `stop`).
   *
   * @param status - the new lead status.
   */
  async onLeadChange(status: LeadStatus): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') {
      return;
    }
    if (status === 'leader') {
      this.setState('leader');
      await this.resumeSweep();
    } else {
      this.setState('follower');
      // We are no longer the processor — stop driving spark terminal transitions + balances.
      this.deps.sparkBalanceTracker.stop();
      this.deps.sparkEventForwarder.stop();
    }
  }

  /**
   * Route one realtime broadcast. Account / transaction / contact changes → the SDK-event
   * forwarders ALWAYS (consumer read-model). Quote / swap changes → the orchestrator kickoff, but
   * ONLY while leader (the processor drives work created by any client; followers ignore them). The
   * orchestrator kickoffs are idempotent + read fresh DB state, so a CREATE and a later UPDATE both
   * safely re-kick.
   *
   * @param event - the master broadcast event NAME.
   * @param payload - the changed DB row.
   */
  dispatch(event: string, payload: BroadcastPayload): void {
    // Always-on forwarders (consumer read-model) — fire regardless of leadership.
    if (event === 'ACCOUNT_CREATED' || event === 'ACCOUNT_UPDATED') {
      void this.deps.accountEventForwarder.handleChange(event, payload);
      return;
    }
    if (event === 'TRANSACTION_CREATED' || event === 'TRANSACTION_UPDATED') {
      void this.deps.transactionEventForwarder.handleChange(event, payload);
      return;
    }
    if (event === 'CONTACT_CREATED' || event === 'CONTACT_DELETED') {
      this.deps.contactEventForwarder.handleChange(event, payload);
      return;
    }
    // Quote/swap changes drive the orchestrator — leader only.
    if (QUOTE_SWAP_EVENTS.has(event) && this.currentState === 'leader') {
      void this.routeQuoteSwapEvent(event);
    }
  }

  /**
   * The no-cache RECONCILE on realtime (re)connect (master's `onConnected → invalidate-all`): when
   * leader, re-run the resume sweep so any quote/swap whose triggering broadcast was missed while
   * the socket was down is re-driven from FRESH DB state. A follower has nothing to reconcile (its
   * read-model is the consumer's; the forwarders fire on each subsequent broadcast).
   */
  async reconcile(): Promise<void> {
    if (this.currentState === 'leader') {
      await this.resumeSweep();
    }
  }

  /**
   * The RESUME SWEEP — the no-cache "listPending" equivalent (§5: pending enumeration is internal
   * to the processor). Reads every repo's unresolved/pending rows FROM THE DB and hands each to the
   * orchestrator's kickoff (which opens the right mint-WS / Breez listener and then auto-steps).
   * Also (re)points the spark substrates at the current online spark accounts + their pending work.
   * Idempotent: every orchestrator kickoff re-reads DB state and tracks by id, so re-sweeping (on
   * reconnect, or a repeated lead) does not double-drive.
   */
  private async resumeSweep(): Promise<void> {
    const userId = await this.deps.getUserId();
    if (!userId) {
      return;
    }

    const [
      cashuSendQuotes,
      cashuSendSwaps,
      cashuReceiveQuotes,
      cashuReceiveSwaps,
      sparkSendQuotes,
      sparkReceiveQuotes,
      accounts,
    ] = await Promise.all([
      this.deps.cashuSendQuoteRepository.getUnresolved(userId),
      this.deps.cashuSendSwapRepository.getUnresolved(userId),
      this.deps.cashuReceiveQuoteRepository.getPending(userId),
      this.deps.cashuReceiveSwapRepository.getPending(userId),
      this.deps.sparkSendQuoteRepository.getUnresolved(userId),
      this.deps.sparkReceiveQuoteRepository.getPending(userId),
      this.deps.accounts.getAllActive(userId),
    ]);

    // --- cashu: open the mint-WS subscription / kick the saga for each unresolved item ---------
    for (const quote of cashuSendQuotes) {
      await this.safe(() =>
        this.deps.orchestrator.executeCashuSendQuote(quote),
      );
    }
    for (const swap of cashuSendSwaps) {
      await this.safe(() => this.deps.orchestrator.executeCashuSendSwap(swap));
    }
    for (const quote of cashuReceiveQuotes) {
      await this.safe(() => this.startCashuReceive(quote));
    }
    for (const swap of cashuReceiveSwaps) {
      await this.safe(() =>
        this.deps.orchestrator.stepCashuReceiveSwap(swap.tokenHash, userId),
      );
    }

    // --- spark: UNPAID sends initiate; CASHU_TOKEN receives open their source-mint melt WS ------
    for (const quote of sparkSendQuotes) {
      await this.safe(() =>
        this.deps.orchestrator.executeSparkSendQuote(quote),
      );
    }
    for (const quote of sparkReceiveQuotes) {
      if (quote.type === 'CASHU_TOKEN') {
        await this.safe(() =>
          this.deps.orchestrator.startSparkTokenReceiveQuote(quote),
        );
      }
    }

    // --- spark substrates: point the Breez balance source + terminal-event driver at the -------
    // online spark accounts and their pending lightning work (terminal transitions come from the
    // Breez stream, not a WS / DB trigger).
    const onlineSparkAccounts = accounts.filter(
      (a): a is SparkAccount => a.type === 'spark' && a.isOnline,
    );
    this.deps.sparkBalanceTracker.track(onlineSparkAccounts);
    this.deps.sparkEventForwarder.track({
      accounts: onlineSparkAccounts,
      sendQuotes: sparkSendQuotes,
      receiveQuotes: sparkReceiveQuotes.filter((q) => q.type === 'LIGHTNING'),
    });
  }

  /** Kick off a single cashu receive quote, routing by its type (LIGHTNING vs cross-account token). */
  private async startCashuReceive(quote: CashuReceiveQuote): Promise<void> {
    if (quote.type === 'CASHU_TOKEN') {
      await this.deps.orchestrator.startCashuTokenReceiveQuote(quote);
    } else {
      await this.deps.orchestrator.startCashuReceiveQuote(quote);
    }
  }

  /**
   * Route a realtime quote/swap event to the orchestrator (leader path). Rather than parse the row
   * (each table has a distinct encrypted shape), re-read the relevant repos' fresh pending set and
   * kick each — cheap, no-cache, and idempotent. The simplest correct reaction to "some quote/swap
   * changed" is to re-sweep the affected protocol's pending work.
   *
   * @param event - the quote/swap event name (used only to pick which protocol to re-sweep).
   */
  private async routeQuoteSwapEvent(event: string): Promise<void> {
    const userId = await this.deps.getUserId();
    if (!userId) {
      return;
    }
    if (event.startsWith('CASHU_SEND_QUOTE')) {
      const quotes =
        await this.deps.cashuSendQuoteRepository.getUnresolved(userId);
      for (const quote of quotes) {
        await this.safe(() =>
          this.deps.orchestrator.executeCashuSendQuote(quote),
        );
      }
    } else if (event.startsWith('CASHU_SEND_SWAP')) {
      const swaps =
        await this.deps.cashuSendSwapRepository.getUnresolved(userId);
      for (const swap of swaps) {
        await this.safe(() =>
          this.deps.orchestrator.executeCashuSendSwap(swap),
        );
      }
    } else if (event.startsWith('CASHU_RECEIVE_QUOTE')) {
      const quotes =
        await this.deps.cashuReceiveQuoteRepository.getPending(userId);
      for (const quote of quotes) {
        await this.safe(() => this.startCashuReceive(quote));
      }
    } else if (event.startsWith('CASHU_RECEIVE_SWAP')) {
      const swaps =
        await this.deps.cashuReceiveSwapRepository.getPending(userId);
      for (const swap of swaps) {
        await this.safe(() =>
          this.deps.orchestrator.stepCashuReceiveSwap(swap.tokenHash, userId),
        );
      }
    } else if (event.startsWith('SPARK_SEND_QUOTE')) {
      const quotes =
        await this.deps.sparkSendQuoteRepository.getUnresolved(userId);
      for (const quote of quotes) {
        await this.safe(() =>
          this.deps.orchestrator.executeSparkSendQuote(quote),
        );
      }
      this.deps.sparkEventForwarder.track({
        accounts: await this.onlineSparkAccounts(userId),
        sendQuotes: quotes,
        receiveQuotes: [],
      });
    } else if (event.startsWith('SPARK_RECEIVE_QUOTE')) {
      const quotes =
        await this.deps.sparkReceiveQuoteRepository.getPending(userId);
      for (const quote of quotes) {
        if (quote.type === 'CASHU_TOKEN') {
          await this.safe(() =>
            this.deps.orchestrator.startSparkTokenReceiveQuote(quote),
          );
        }
      }
      this.deps.sparkEventForwarder.track({
        accounts: await this.onlineSparkAccounts(userId),
        sendQuotes: [],
        receiveQuotes: quotes.filter((q) => q.type === 'LIGHTNING'),
      });
    }
  }

  /** The current online spark accounts (a fresh DB read; no cache). */
  private async onlineSparkAccounts(userId: string): Promise<SparkAccount[]> {
    const accounts = await this.deps.accounts.getAllActive(userId);
    return accounts.filter(
      (a): a is SparkAccount => a.type === 'spark' && a.isOnline,
    );
  }

  /** Run an orchestrator kickoff, logging (not throwing) so one bad item never aborts the sweep. */
  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      console.warn('Background processor: failed to drive a task', {
        cause: error,
      });
    }
  }

  /** Set the lifecycle state + emit `background:state` (only on an actual change). */
  private setState(state: BackgroundState): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;
    this.deps.events.emit('background:state', { state });
  }
}
