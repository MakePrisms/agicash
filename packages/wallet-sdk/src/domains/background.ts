/**
 * `BackgroundDomain` implementation — §10 of the contract, Slice 5 / PR7 (reactive overlay, design B).
 *
 * NET-NEW (no master analogue — master gates a `<TaskProcessor/>` React component on a lead hook;
 * there is no `start`/`stop`/`state` API). A thin facade over the {@link BackgroundProcessor}
 * engine (leader election + the always-on realtime forwarding + the reactive cache-invalidation
 * backstop + the leader-gated resume sweep), which `Sdk.create` builds and wires. Keeping the
 * engine separate keeps the public domain a stable, trivially-delegating surface.
 *
 * REACTIVE OVERLAY: `state()` is an OBSERVABLE FETCH → `Query<BackgroundState>` (TanStack hidden).
 * Unlike the other domains' reads its fetch body is NOT a DB read — it returns the processor's
 * in-memory lifecycle state. The processor WRITES the backing `['background:state']` `Query` key on
 * each transition (`setQueryData`, alongside its `background:state` event), so a `state()` subscriber
 * updates live as the engine moves `stopped → starting → follower/leader → stopping → stopped`. The
 * `Query` is memoised so repeated `state()` calls return the SAME stable ref (matching the per-key
 * memo the other reactive domains use). `start()` / `stop()` are ACTIONS → `Promise` (delegated).
 *
 * @module
 */
import type { BackgroundDomain } from '../domains';
import {
  BACKGROUND_STATE_KEY,
  type BackgroundProcessor,
} from '../internal/background-processor';
import { type QueryClient, toQuery } from '../query';
import type { BackgroundState } from '../types/events';
import type { Query } from '../types/query';

/**
 * The background-processing lifecycle domain. Leader election is an internal DB-row lock
 * (`wallet.task_processing_locks` + `take_lead`, 5 s poll) shared across tabs / devices /
 * processes; only the leader runs the orchestrators (which read the DB as needed). State
 * transitions are surfaced via the observable `state()` `Query` (and the `background:state` event).
 */
export class BackgroundDomainImpl implements BackgroundDomain {
  /** Memoised observable `state()` `Query` (a stable ref across calls). Hidden inside the SDK. */
  private q: Query<BackgroundState> | undefined;

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers; backs the
   *   observable `state()` read — the processor writes its `['background:state']` key on each
   *   transition).
   * @param processor - the background engine this domain delegates to.
   */
  constructor(
    private readonly client: QueryClient,
    private readonly processor: BackgroundProcessor,
  ) {}

  /**
   * Begin lead-polling and run the orchestrators while this instance is leader. Also subscribes the
   * single `wallet:${userId}` realtime channel (the SDK's typed `account:*` / `transaction:*` /
   * `contact:*` events fire — and the reactive cache invalidation runs — from it regardless of
   * leadership). Resolves once polling has started; the actual `follower` / `leader` state is
   * reported via the observable `state()` `Query` (+ `background:state`).
   */
  start(): Promise<void> {
    return this.processor.start();
  }

  /**
   * Pause processing — stop lead-polling, unsubscribe realtime, and stop driving spark terminal
   * transitions. In-flight operations already started finish; connections are not torn down (a
   * later `start` resumes). Use `Sdk.destroy()` for full teardown.
   */
  stop(): Promise<void> {
    return this.processor.stop();
  }

  /**
   * The current background-processing lifecycle state — as an observable {@link Query}. The fetch
   * body returns the processor's in-memory state; the processor writes the backing key on each
   * transition, so subscribers go live. Memoised (one stable `Query` ref).
   *
   * @returns a stable `Query<BackgroundState>`.
   */
  state(): Query<BackgroundState> {
    if (!this.q) {
      this.q = toQuery<BackgroundState>(
        this.client,
        [...BACKGROUND_STATE_KEY],
        async () => this.processor.state(),
      );
    }
    return this.q;
  }
}
