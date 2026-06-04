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
 * REACTIVE OVERLAY (design B) — THE CACHE-INVALIDATION BACKSTOP. The reactive SDK exposes its reads
 * as `Query<T>` (TanStack hidden); a `.get(id)` / `list()` subscriber only goes live if SOMETHING
 * invalidates its memoised key when the underlying DB row changes. Master-faithful freshness model
 * (Josip): the orchestrator/processor advance the DB + emit events, and the REALTIME SUBSCRIPTION
 * detects the DB change and invalidates the Query cache (NOT the orchestrator writing the cache).
 * So {@link dispatch} does BOTH on each `wallet:${userId}` broadcast: (1) the no-cache behaviour —
 * emit the typed event (account/transaction/contact) and/or drive the orchestrator (quote/swap,
 * leader-only); and (2) the reactive net-new — invalidate the matching memoised `Query` key(s) (see
 * {@link invalidate}), regardless of leadership, so every read goes live. The processor/orchestrator
 * NEVER write the cache directly — the DB-change broadcast is the single trigger.
 *
 * Leadership is the {@link LeaderElection} timer loop over the lifted `take_lead` lock; this class
 * reacts to its transitions. The single `wallet:${userId}` channel is the {@link RealtimeHub}.
 *
 * @module
 */
import type { QueryClient } from '../query';
import type { SparkAccount } from '../types/account';
import type { CashuReceiveQuote } from '../types/cashu';
import type { BackgroundState, SdkEventMap } from '../types/events';
import type { AccountEventForwarder } from './account-event-forwarder';
import type { AccountRepository } from './account-repository';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import type { ContactEventForwarder } from './contact-event-forwarder';
import type { TypedEventEmitter } from './event-emitter';
import type { LeadStatus, LeaderElection } from './leader-election';
import type { Orchestrator } from './orchestrator';
import type { BroadcastPayload, RealtimeHub } from './realtime-hub';
import type { SparkBalanceTracker } from './spark-balance-tracker';
import type { SparkEventForwarder } from './spark-event-forwarder';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import type { TransactionEventForwarder } from './transaction-event-forwarder';

/** The SDK-internal collaborators the background processor drives (all built by `Sdk.create`). */
export type BackgroundProcessorDeps = {
  events: TypedEventEmitter<SdkEventMap>;
  /**
   * The SDK-internal TanStack `QueryClient`. The reactive cache-invalidation backstop: on each
   * `wallet:${userId}` DB-change broadcast the processor invalidates the matching memoised `Query`
   * key(s) (see {@link BackgroundProcessor.invalidate}) so `.get(id)` / `list()` subscribers go
   * live. Also backs the `background:state` `Query` (the processor writes it on each transition).
   * Never exposed to consumers.
   */
  client: QueryClient;
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
 * The memoised `Query` key for the observable {@link BackgroundDomainImpl.state}. The processor
 * SEEDS + WRITES this key on each lifecycle transition (the only `Query` the processor owns rather
 * than invalidates — its value is the in-memory state, not a DB read).
 */
export const BACKGROUND_STATE_KEY = ['background:state'] as const;

/**
 * Drives the leader-elected autonomous orchestrators + the always-on realtime event forwarding +
 * the reactive cache-invalidation backstop. Framework-free; one instance per SDK, exposed through
 * {@link BackgroundDomainImpl}.
 */
export class BackgroundProcessor {
  /** The lifecycle state (also surfaced via `background:state` + `BackgroundDomain.state()`). */
  private currentState: BackgroundState = 'stopped';

  constructor(private readonly deps: BackgroundProcessorDeps) {}

  /** The current lifecycle state (synchronous; backs the `background:state` `Query` fetch body). */
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
   * Route one realtime broadcast. Does BOTH halves of the reactive freshness model:
   *  - the REACTIVE BACKSTOP (always, leadership-independent): invalidate the matching memoised
   *    `Query` key(s) so `.get(id)` / `list()` subscribers re-read the changed DB row (see
   *    {@link invalidate});
   *  - the NO-CACHE behaviour: account / transaction / contact changes → the SDK-event forwarders
   *    ALWAYS (consumer read-model); quote / swap changes → the orchestrator kickoff, but ONLY
   *    while leader (the processor drives work created by any client; followers ignore them). The
   *    orchestrator kickoffs are idempotent + read fresh DB state, so a CREATE and a later UPDATE
   *    both safely re-kick.
   *
   * @param event - the master broadcast event NAME.
   * @param payload - the changed DB row.
   */
  dispatch(event: string, payload: BroadcastPayload): void {
    // Reactive net-new: invalidate the matching Query key(s) so subscribers re-read the change.
    // Runs for EVERY broadcast (incl. quote/swap + user) and regardless of leadership — a
    // follower's `.get(id)` must still go live.
    this.invalidate(event, payload);

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
   * THE REACTIVE CACHE-INVALIDATION BACKSTOP. Maps one `wallet:${userId}` broadcast (event NAME +
   * the changed row) to the memoised `Query` key(s) the affected domain reads from, and
   * invalidates them on the SDK-internal `QueryClient` so its observers refetch FRESH DB state.
   * Master-faithful: the DB-change broadcast is the single freshness trigger (the processor /
   * orchestrator never write the cache directly).
   *
   * Each invalidate uses the EXACT key the domain memoises on (so `invalidateQueries` matches the
   * live observers):
   *  - account → `['accounts']` (the list) + `['account', id]` + `['accounts:default']` (its
   *    `isDefault`/default-first sort depends on the changed account);
   *  - transaction → `['transactions']` (every paginated page — a prefix match) + `['transaction',
   *    id]` + `['transactions:pendingAck']` (the ack count);
   *  - contact → `['contacts']` + `['contact', id]`;
   *  - cashu send quote/swap → `['cashuSend', id]`; cashu receive → `['cashuReceive', id]`;
   *  - spark send quote → `['sparkSend', id]`; spark receive → `['sparkReceive', id]`;
   *  - user → `['currentUser']`.
   *
   * The per-id keys are only invalidated when the row carries an `id` (the broadcast row always
   * does — see master's per-table broadcast payloads); the collection / prefix keys are always
   * invalidated. Best-effort + fire-and-forget (an invalidate never throws into the dispatch path).
   *
   * @param event - the master broadcast event NAME.
   * @param payload - the changed DB row (its `id` keys the per-id `Query`).
   */
  private invalidate(event: string, payload: BroadcastPayload): void {
    const client = this.deps.client;
    const id: string | undefined =
      payload && typeof payload === 'object' ? payload.id : undefined;
    const invalidate = (queryKey: readonly unknown[]): void => {
      void client.invalidateQueries({ queryKey });
    };

    if (event.startsWith('ACCOUNT_')) {
      invalidate(['accounts']);
      invalidate(['accounts:default']);
      if (id) {
        invalidate(['account', id]);
      }
    } else if (event.startsWith('TRANSACTION_')) {
      // `['transactions']` is a PREFIX — matches every memoised page key
      // `['transactions', accountId, cursor, pageSize]`.
      invalidate(['transactions']);
      invalidate(['transactions:pendingAck']);
      if (id) {
        invalidate(['transaction', id]);
      }
    } else if (event.startsWith('CONTACT_')) {
      invalidate(['contacts']);
      if (id) {
        invalidate(['contact', id]);
      }
    } else if (event.startsWith('CASHU_SEND_')) {
      if (id) {
        invalidate(['cashuSend', id]);
      }
    } else if (event.startsWith('CASHU_RECEIVE_')) {
      if (id) {
        invalidate(['cashuReceive', id]);
      }
    } else if (event.startsWith('SPARK_SEND_')) {
      if (id) {
        invalidate(['sparkSend', id]);
      }
    } else if (event.startsWith('SPARK_RECEIVE_')) {
      if (id) {
        invalidate(['sparkReceive', id]);
      }
    } else if (event.startsWith('USER_')) {
      invalidate(['currentUser']);
    }
  }

  /**
   * The no-cache RECONCILE on realtime (re)connect (master's `onConnected → invalidate-all`): when
   * leader, re-run the resume sweep so any quote/swap whose triggering broadcast was missed while
   * the socket was down is re-driven from FRESH DB state. ALSO invalidates ALL the read-model
   * collection keys (the reactive analogue of master's cache invalidate-all) so every `Query`
   * subscriber catches up on anything missed while disconnected, regardless of leadership.
   */
  async reconcile(): Promise<void> {
    // Reactive net-new: master invalidates ALL its caches on (re)connect; the reactive SDK
    // invalidates every read-model collection key so subscribers refetch the catch-up state.
    this.invalidateAll();
    if (this.currentState === 'leader') {
      await this.resumeSweep();
    }
  }

  /**
   * Invalidate every read-model collection key (the reactive analogue of master's
   * `onConnected → invalidate-all`). Used on realtime (re)connect to catch up on any change whose
   * broadcast was missed while the socket was down. The collection keys are prefixes, so the per-id
   * `Query`s (`['account', id]` etc.) are caught by `['account']` etc. matching their prefix.
   */
  private invalidateAll(): void {
    const client = this.deps.client;
    for (const key of [
      ['accounts'],
      ['accounts:default'],
      ['account'],
      ['transactions'],
      ['transactions:pendingAck'],
      ['transaction'],
      ['contacts'],
      ['contact'],
      ['cashuSend'],
      ['cashuReceive'],
      ['sparkSend'],
      ['sparkReceive'],
      ['currentUser'],
    ]) {
      void client.invalidateQueries({ queryKey: key });
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

  /**
   * Set the lifecycle state + emit `background:state` (only on an actual change). ALSO writes the
   * new state into the `['background:state']` `Query` so the observable
   * {@link BackgroundDomainImpl.state} read goes live for its subscribers (the reactive net-new for
   * this domain — the state is in-memory, not a DB read, so the processor writes it directly).
   */
  private setState(state: BackgroundState): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;
    this.deps.events.emit('background:state', { state });
    // Reactive: push the new state to the observable `state()` Query's subscribers.
    this.deps.client.setQueryData([...BACKGROUND_STATE_KEY], state);
  }
}
