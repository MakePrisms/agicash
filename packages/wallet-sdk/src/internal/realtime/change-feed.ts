import type { EventBus } from '../event-bus';
import type { SdkCoreEventMap } from '../../events';
import type { SupabaseRealtimeManager } from './supabase-realtime-manager';
import type { SupabaseRealtimeChannel } from './supabase-realtime-channel';
import { routeChangeFeedEvent, type ChangeFeedRouterDeps } from './change-feed-router';
import { deriveLifecycleEvent } from './lifecycle-events';
import type { EntityFanout, ProcessorTrigger } from './change-feed-ports';

export type ChangeFeedDeps = {
  manager: SupabaseRealtimeManager;
  events: EventBus<SdkCoreEventMap>;
  /** Assembled by Plan 4c from WalletRuntime + protocols + domain. */
  routerDeps: ChangeFeedRouterDeps;
  /** Variant-supplied: A emits row events; B upserts stores. */
  fanout: EntityFanout;
  /** Plan 4c-supplied: the six background processors. */
  trigger: ProcessorTrigger;
};

/**
 * Manages the per-user Supabase Realtime subscription for the wallet change-feed.
 *
 * On each broadcast event: routes to a typed `ChangeFeedChange` (Task 3) → fans
 * the change out to the variant view (Task 5 `EntityFanout`) → derives and emits
 * the core lifecycle event if this is a terminal transition (Task 4 + EventBus) →
 * signals the background processors (Task 5 `ProcessorTrigger`).
 *
 * On every (re)connect (`onConnected`): emits `connection:state {connected}` then
 * runs catch-up (`fanout.onCatchUp` + `trigger.onCatchUp`) so the variant reloads
 * any rows that arrived while the channel was dark.
 *
 * The `emittedTerminalIds` set deduplicates lifecycle events across reconnects: it
 * accumulates over the lifetime of the session and is cleared only on `stop()`. This
 * means a terminal event is emitted exactly once even if the same row arrives again
 * on a replay after reconnect.
 */
export class ChangeFeed {
  private channel?: SupabaseRealtimeChannel;
  private unsubscribeStatus?: () => void;
  private lastConnectionState?: 'connected' | 'disconnected';
  private disposed = false;
  private readonly emittedTerminalIds = new Set<string>();

  private readonly manager: SupabaseRealtimeManager;
  private readonly events: EventBus<SdkCoreEventMap>;
  private readonly routerDeps: ChangeFeedRouterDeps;
  private readonly fanout: EntityFanout;
  private readonly trigger: ProcessorTrigger;

  constructor(deps: ChangeFeedDeps) {
    this.manager = deps.manager;
    this.events = deps.events;
    this.routerDeps = deps.routerDeps;
    this.fanout = deps.fanout;
    this.trigger = deps.trigger;
  }

  /**
   * Subscribes to the per-user broadcast channel and begins handling change-feed
   * events. Idempotent: a second call is a no-op while the channel is alive.
   *
   * After subscribing, `onConnected` fires once the channel reaches SUBSCRIBED and
   * again on every subsequent reconnect, triggering a catch-up reload each time.
   */
  public async start(userId: string): Promise<void> {
    if (this.channel) return;
    this.disposed = false;

    const builder = this.manager
      .channel(`wallet:${userId}`, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        void this.handle(event, payload);
      });

    this.channel = this.manager.addChannel(builder);

    // Register the status listener before subscribing so no status transitions
    // between addChannel and subscribe are missed.
    this.unsubscribeStatus = this.manager.subscribeToChannelStatusChange(
      this.channel.topic,
      this.onStatusChange,
    );

    await this.channel.subscribe(this.onConnected);
  }

  /**
   * Triggers a coarse catch-up without re-subscribing: signals both the fanout
   * and processor trigger to reload their work sets from the current DB snapshot.
   *
   * Does NOT call `channel.subscribe()` again — the manager uses a subscriber
   * refcount and re-subscribing would leak it. Subscription liveness is the
   * manager's responsibility (via `setOnlineStatus`/`setActiveStatus`).
   */
  public resync(): void {
    this.runCatchUp();
  }

  /**
   * Unsubscribes the channel, removes the status listener, and resets all
   * session state. Safe to call multiple times (idempotent after the first call).
   *
   * Note: clearing `emittedTerminalIds` here is intentional — this is a full
   * teardown. Reconnects do NOT call `stop()`, so the set persists across
   * reconnects to prevent duplicate lifecycle emissions on resubscribe.
   */
  public async stop(): Promise<void> {
    this.disposed = true;
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = undefined;

    if (this.channel) {
      await this.channel.unsubscribe(this.onConnected);
      this.channel = undefined;
    }

    this.emittedTerminalIds.clear();
    this.lastConnectionState = undefined;
  }

  /** Alias so Plan 4c can call either `stop()` or `dispose()`. */
  public readonly dispose = this.stop.bind(this);

  private readonly onConnected = (): void => {
    this.setConnectionState('connected');
    this.runCatchUp();
  };

  private readonly onStatusChange = (): void => {
    if (!this.channel) return;
    const status = this.manager.getChannelStatus(this.channel.topic);
    if (status === 'error' || status === 'closed') {
      this.setConnectionState('disconnected');
    }
    // 'reconnecting' and 'subscribing' are transitional — no state change.
    // 'connected' is owned exclusively by onConnected.
  };

  private setConnectionState(state: 'connected' | 'disconnected'): void {
    if (this.lastConnectionState === state) return;
    this.lastConnectionState = state;
    this.events.emit('connection:state', { state });
  }

  private runCatchUp(): void {
    this.fanout.onCatchUp();
    this.trigger.onCatchUp();
  }

  private async handle(event: string, payload: unknown): Promise<void> {
    // Wrap the entire body: router, converters, and ports can all throw, and
    // this method is called fire-and-forget from the broadcast callback. An
    // unhandled rejection here could crash a Node host.
    try {
      const change = await routeChangeFeedEvent(event, payload, this.routerDeps);
      if (this.disposed || !change) return; // torn-down or unknown event

      // Order matters:
      //   1. fanout first — variant B's processors read the stores the fanout just wrote.
      //   2. lifecycle next — notify after the view is fresh so consumers see current state.
      //   3. trigger last — processors may cause further transitions and new events.
      this.fanout.emit(change);

      const emit = deriveLifecycleEvent(change, this.emittedTerminalIds);
      if (emit) {
        this.events.emit(emit.type, emit.payload);
      }

      this.trigger.onEntityChange(change);
    } catch (error) {
      console.error('change-feed: failed handling broadcast event', { event, error });
    }
  }
}
