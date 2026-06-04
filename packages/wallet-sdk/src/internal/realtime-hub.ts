/**
 * Realtime broadcast hub — Slice 5 / PR7 (background + realtime).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts`. Master subscribes ONE private
 * broadcast channel — `wallet:${userId}` — with `.on('broadcast', { event: '*' })`, then fans each
 * message out to per-table handlers (keyed by the event NAME) and, on (re)connect, invalidates all
 * its TanStack caches to catch up on anything missed while disconnected.
 *
 * The framework-free SDK keeps the SAME single channel but strips the React/`useSupabaseRealtime`
 * layer: this class is pure transport. It subscribes the channel over the SDK-owned Supabase
 * realtime client and forwards `(event, payload)` to an injected {@link dispatch} function (the
 * {@link BackgroundProcessor} owns the routing — name → SDK-event forwarder, leader-gated
 * quote/swap → orchestrator); on initial connect / reconnect it calls {@link onConnected} (the
 * processor's no-cache RECONCILE: a refetch-and-emit + a resume sweep, replacing master's
 * invalidate-all). Errors / reconnects use supabase-js's own retry — the heavyweight
 * `SupabaseRealtimeManager` reconnect-orchestration is NOT ported (it manages multiple channels +
 * tab-visibility; the SDK has exactly one channel and leaves the socket policy to supabase-js).
 *
 * @module
 */
import type {
  RealtimeChannel,
  REALTIME_SUBSCRIBE_STATES,
} from '@supabase/supabase-js';
import type { WalletSupabaseClient } from './supabase-client';

/** A broadcast row payload (the changed DB row — shape is per-table; the dispatcher narrows it). */
// biome-ignore lint/suspicious/noExplicitAny: each table's handler narrows its own row shape.
export type BroadcastPayload = any;

/** Collaborators the hub needs. */
export type RealtimeHubDeps = {
  /** The SDK-owned Supabase client (its realtime socket carries the channel). */
  supabase: WalletSupabaseClient;
  /**
   * Route one broadcast message. `event` is the master event NAME (e.g. `ACCOUNT_UPDATED`,
   * `CASHU_SEND_QUOTE_CREATED`); `payload` is the changed row. The processor owns the routing.
   */
  dispatch: (event: string, payload: BroadcastPayload) => void;
  /**
   * Called when the channel is initially connected OR reconnected — the no-cache reconcile (refetch
   * the in-flight DB state + re-emit / resume), replacing master's cache invalidate-all.
   */
  onConnected: () => void;
};

/**
 * Subscribes the single `wallet:${userId}` broadcast channel and forwards each message + connect
 * event to the injected callbacks. Framework-free; one channel per running SDK, owned by the
 * {@link BackgroundProcessor}.
 */
export class RealtimeHub {
  /** The live channel while subscribed, or null when stopped. */
  private channel: RealtimeChannel | null = null;

  constructor(private readonly deps: RealtimeHubDeps) {}

  /**
   * Subscribe the `wallet:${userId}` private broadcast channel. Idempotent — a second `subscribe`
   * while already subscribed is a no-op (master likewise reference-counts a single channel).
   *
   * @param userId - the signed-in user's id (the channel is `wallet:${userId}`).
   */
  subscribe(userId: string): void {
    if (this.channel) {
      return;
    }
    const channel = this.deps.supabase
      .channel(`wallet:${userId}`, { config: { private: true } })
      .on(
        'broadcast',
        { event: '*' },
        (message: { event: string; payload?: BroadcastPayload }) => {
          this.deps.dispatch(message.event, message.payload);
        },
      );
    this.channel = channel;
    channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === 'SUBSCRIBED') {
        // Initial connect OR reconnect → reconcile (catch up on anything missed). Master invalidates
        // its caches here; the no-cache SDK refetches the in-flight DB state + re-emits / resumes.
        this.deps.onConnected();
      }
    });
  }

  /**
   * Unsubscribe + drop the channel. Awaitable so `destroy()` / `stop()` can sequence teardown. A
   * stop while not subscribed is a no-op.
   */
  async stop(): Promise<void> {
    const channel = this.channel;
    if (!channel) {
      return;
    }
    this.channel = null;
    await this.deps.supabase.removeChannel(channel);
  }

  /** Whether the channel is currently subscribed (held). */
  isSubscribed(): boolean {
    return this.channel !== null;
  }
}
