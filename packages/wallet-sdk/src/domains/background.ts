import { DomainError } from '../errors';
import type { BackgroundState, SdkCoreEventMap } from '../events';
import type { ProcessorRegistry } from '../internal/background/processor-registry';
import type { TaskProcessingLockRepository } from '../internal/background/task-processing-lock-repository';
import type { EventBus } from '../internal/event-bus';
import type { ChangeFeed } from '../internal/realtime/change-feed';
import type { SupabaseRealtimeManager } from '../internal/realtime/supabase-realtime-manager';

const LEASE_POLL_INTERVAL_MS = 5_000;

export type IntervalScheduler = {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
};

const defaultScheduler: IntervalScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
};

export type BackgroundDeps = {
  lockRepo: TaskProcessingLockRepository;
  changeFeed: ChangeFeed;
  registry: ProcessorRegistry;
  manager: SupabaseRealtimeManager;
  events: EventBus<SdkCoreEventMap>;
  /** Resolve the signed-in user id; null if not signed in. */
  getUserId: () => Promise<string | null>;
  /** Leader-election instance id (config.clientId ?? crypto.randomUUID()). */
  clientId: string;
  /** Test seam; defaults to global setInterval/clearInterval. */
  scheduler?: IntervalScheduler;
  pollIntervalMs?: number;
};

/**
 * Leader election + background lifecycle. The ChangeFeed (realtime) runs for EVERY
 * instance (follower + leader); the six processors run on the LEADER only.
 * Leadership = the `take_lead` 6s DB lease polled every 5s; a lost lease relies on
 * expiry (no explicit release — matches the app). `setActiveStatus(false)` pauses
 * polling so a backgrounded instance yields leadership.
 */
export class BackgroundDomain {
  private _state: BackgroundState = 'stopped';
  private userId: string | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private active = true;
  private readonly scheduler: IntervalScheduler;
  private readonly pollIntervalMs: number;

  constructor(private readonly deps: BackgroundDeps) {
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.pollIntervalMs = deps.pollIntervalMs ?? LEASE_POLL_INTERVAL_MS;
  }

  get state(): BackgroundState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state !== 'stopped') return;
    this.setState('starting');
    const userId = await this.deps.getUserId();
    if (!userId) {
      this.setState('stopped');
      throw new DomainError(
        'Cannot start background processing: not signed in.',
      );
    }
    this.userId = userId;
    await this.deps.changeFeed.start(userId);
    this.setState('follower');
    // An instance started while inactive (e.g. opened in a background tab) parks
    // at follower: it must NOT grab leadership without scheduling renewal, or it
    // would hold a lease it never refreshes (stale/double leader). It promotes via
    // setActiveStatus(true) when the host reports the tab active.
    if (this.active) {
      await this.poll();
      this.startPolling();
    }
  }

  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'stopping') return;
    this.setState('stopping');
    this.stopPolling();
    this.deps.registry.deactivate();
    await this.deps.changeFeed.stop();
    this.userId = null;
    this.setState('stopped');
  }

  resync(): void {
    this.deps.changeFeed.resync();
  }

  setOnlineStatus(isOnline: boolean): void {
    this.deps.manager.setOnlineStatus(isOnline);
  }

  setActiveStatus(isActive: boolean): void {
    this.active = isActive;
    this.deps.manager.setActiveStatus(isActive);
    if (this._state === 'stopped' || this._state === 'stopping') return;
    if (isActive) {
      void this.poll();
      this.startPolling();
    } else {
      this.stopPolling();
      if (this._state === 'leader') {
        this.setState('follower');
        this.deps.registry.deactivate();
      }
    }
  }

  dispose(): Promise<void> {
    return this.stop();
  }

  private startPolling(): void {
    if (this.pollHandle !== null || !this.active) return;
    this.pollHandle = this.scheduler.setInterval(
      () => void this.poll(),
      this.pollIntervalMs,
    );
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      this.scheduler.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.userId) return;
    if (this._state !== 'follower' && this._state !== 'leader') return;
    this.polling = true;
    try {
      const isLead = await this.deps.lockRepo.takeLead(
        this.userId,
        this.deps.clientId,
      );
      if (isLead && this._state === 'follower') {
        this.setState('leader');
        this.deps.registry.activate(this.userId);
      } else if (!isLead && this._state === 'leader') {
        this.setState('follower');
        this.deps.registry.deactivate();
      }
    } catch (cause) {
      console.warn('Take lead request failed. Will retry.', { cause });
    } finally {
      this.polling = false;
    }
  }

  private setState(state: BackgroundState): void {
    if (this._state === state) return;
    this._state = state;
    this.deps.events.emit('background:state', { state });
  }
}
