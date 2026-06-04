/**
 * `BackgroundDomain` implementation — Slice 5 / PR7. The public §10 surface.
 *
 * NET-NEW (no master analogue — master gates a `<TaskProcessor/>` React component on a lead hook;
 * there is no `start`/`stop`/`state` API). A thin facade over the {@link BackgroundProcessor}
 * engine (leader election + the always-on realtime forwarding + the leader-gated resume sweep),
 * which `Sdk.create` builds and wires. Keeping the engine separate keeps the public domain a
 * stable, trivially-delegating surface.
 *
 * @module
 */
import type { BackgroundDomain } from '../domains';
import type { BackgroundProcessor } from '../internal/background-processor';
import type { BackgroundState } from '../events';

/**
 * The background-processing lifecycle domain. Leader election is an internal DB-row lock
 * (`wallet.task_processing_locks` + `take_lead`, 5 s poll) shared across tabs / devices /
 * processes; only the leader runs the orchestrators (which read the DB as needed). State
 * transitions are surfaced via `background:state`.
 */
export class BackgroundDomainImpl implements BackgroundDomain {
  /**
   * @param processor - the background engine this domain delegates to.
   */
  constructor(private readonly processor: BackgroundProcessor) {}

  /**
   * Begin lead-polling and run the orchestrators while this instance is leader. Also subscribes the
   * single `wallet:${userId}` realtime channel (the SDK's typed `account:*` / `transaction:*` /
   * `contact:*` events fire from it regardless of leadership). Resolves once polling has started;
   * the actual `follower` / `leader` state is reported via `background:state`.
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

  /** The current background-processing lifecycle state (synchronous). */
  state(): BackgroundState {
    return this.processor.state();
  }
}
