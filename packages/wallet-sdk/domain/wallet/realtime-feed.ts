import { delay as sleep } from '@agicash/utils';
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeClient,
} from '@supabase/supabase-js';
import {
  type RunScope,
  type RunScopes,
  type ScopeClock,
  createRunScopes,
} from '../../lib/run-scope';
import type {
  ActivityMonitor,
  AuthSession,
  Logger,
  WalletEventMap,
} from '../sdk';
import type { ToWalletEvent, WalletEventMessage } from './realtime-broadcasts';

/**
 * The wait before each rejoin of a failed channel. A failure after the last
 * wait is terminal.
 */
export const RETRY_DELAYS_MS = [
  0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000,
];

/** A joined channel; `leave()` resolves once the channel is removed and its topic is free for a new join. */
export type RealtimeJoin = { leave(): Promise<void> };

/** The narrow seam over realtime-js the feed drives; faked in tests. */
export type RealtimeTransport = {
  /** Re-resolves the access token for the socket (`realtime.setAuth()`). */
  refreshAuth(): Promise<void>;
  /**
   * Joins a private broadcast channel and reports its status changes. Calls
   * `listener` only after it returns; realtime-js 2.95.2 resets the join push
   * before it registers the status hooks.
   */
  join(
    topic: string,
    listener: {
      onBroadcast(event: string, payload: unknown): void;
      onStatus(status: REALTIME_SUBSCRIBE_STATES, error?: Error): void;
    },
  ): RealtimeJoin;
};

/**
 * Adapts a Supabase `RealtimeClient` to the feed's transport seam.
 *
 * @param getToken Resolves the session JWT the client's `accessToken` callback
 * returns; `refreshAuth()` rejects when it rejects or resolves null.
 */
export function createSupabaseRealtimeTransport(
  client: RealtimeClient,
  getToken: () => Promise<string | null>,
): RealtimeTransport {
  return {
    refreshAuth: async () => {
      // setAuth() swallows a throwing accessToken callback and keeps the
      // previously cached token, so check the token before handing over.
      if ((await getToken()) === null) {
        throw new Error('No session token');
      }
      await client.setAuth();
    },
    join(topic, listener) {
      const channel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: '*' }, ({ event, payload }) =>
          listener.onBroadcast(event, payload),
        )
        .subscribe((status, error) => listener.onStatus(status, error));
      return {
        leave: async () => {
          const status = await client.removeChannel(channel);
          if (status === 'error') {
            // Defensive for other realtime-js versions (2.95.2 always leaves
            // 'ok'): an 'error' reply skips the close hook, leaving the topic
            // registered so channel(topic) would return this channel.
            client.channels = client.channels.filter((c) => c !== channel);
            channel.teardown();
          }
          // Removing the last channel disconnects the socket, which stays
          // 'disconnecting' until a 100 ms fallback timer; connect() is a
          // no-op meanwhile, so a join now would buffer until it times out.
          while (client.isDisconnecting()) {
            await sleep(10);
          }
        },
      };
    },
  };
}

export type RealtimeFeedDeps = {
  transport: RealtimeTransport;
  getSession: () => AuthSession;
  toWalletEvent: ToWalletEvent;
  activity: ActivityMonitor;
  emit: (message: WalletEventMessage) => void;
  logger: Logger;
  /** Test seam; defaults to the global timers. */
  clock?: ScopeClock;
};

export type RealtimeFeed = {
  /** Opens the channel for the live session's user; no-op when logged out, disposed, or already open for that user. */
  open(): void;
  /** Leaves the channel and drops every wallet event still in flight. Synchronous; idempotent; emits nothing. */
  close(): void;
  /** `close()`, then every later `open()` is a no-op. */
  dispose(): void;
};

const systemClock: ScopeClock = {
  setInterval(callback, ms) {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  },
  setTimeout(callback, ms) {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
};

type ConnectionState = WalletEventMap['connection.changed']['state'];

/** How one join ended. */
type JoinEnd = {
  /** `closed`: the channel reported CLOSED. `failed`: an error, a timeout, or a rejected auth refresh. */
  kind: 'closed' | 'failed';
  /** The channel reached SUBSCRIBED before it ended. */
  subscribed: boolean;
  cause?: unknown;
};

class RealtimeFeedRuntime implements RealtimeFeed {
  private topic: string | undefined;
  private channel: RealtimeJoin | undefined;
  /**
   * Settles when every channel left so far is gone, including the socket's
   * disconnect window (see the transport's `leave()`). Each join waits for
   * it: realtime-js hands back a channel still registered for the topic, and
   * that channel never reports a status. It spans sessions, so the next
   * user's join waits too.
   */
  private leaving: Promise<void> = Promise.resolve();
  /** The channel is down until the next activation starts a new run. */
  private parked = false;
  private reported: ConnectionState | undefined;
  private disposed = false;
  private readonly scopes: RunScopes;

  constructor(private readonly deps: RealtimeFeedDeps) {
    this.scopes = createRunScopes(deps.clock ?? systemClock);
  }

  open(): void {
    if (this.disposed) return;
    const session = this.deps.getSession();
    if (!session.isLoggedIn) return;
    const topic = `wallet:${session.user.id}`;
    if (topic === this.topic) return;
    this.close();
    this.topic = topic;
    const scope = this.scopes.renew();
    const unsubscribeActivity = this.deps.activity.subscribe(() => {
      if (this.parked && this.deps.activity.isActive()) {
        void this.run(scope, topic);
      }
    });
    scope.onCleanup(unsubscribeActivity);
    void this.run(scope, topic);
  }

  close(): void {
    // Cancel first: leave() can report CLOSED synchronously, and the dead
    // scope has already ended the join that would receive it.
    this.scopes.cancel();
    this.leaveChannel();
    this.topic = undefined;
    this.parked = false;
    this.reported = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }

  /**
   * Keeps the channel joined. After a failure it waits the next
   * `RETRY_DELAYS_MS` delay and joins again; a failure after the last delay
   * is terminal. A CLOSED channel, or a failure while inactive outside a
   * retry cycle, parks the feed until the next activation. A cycle that has
   * started keeps retrying while inactive, as on master.
   */
  private async run(scope: RunScope, topic: string): Promise<void> {
    this.parked = false;
    let retries = 0;
    while (scope.alive) {
      const end = await this.joinUntilEnd(scope, topic);
      if (end === undefined || !scope.alive) return;
      this.leaveChannel();
      if (end.subscribed) retries = 0;

      if (
        end.kind === 'closed' ||
        (retries === 0 && !this.deps.activity.isActive())
      ) {
        this.parked = true;
        this.report('reconnecting');
        return;
      }
      if (retries === RETRY_DELAYS_MS.length) {
        this.deps.logger.error('Realtime channel failed', {
          topic,
          cause: end.cause,
        });
        this.report('error');
        return;
      }

      const delay = RETRY_DELAYS_MS[retries];
      retries += 1;
      this.report('reconnecting');
      this.deps.logger.debug('Realtime channel scheduled resubscribe attempt', {
        topic,
        attempt: `${retries}/${RETRY_DELAYS_MS.length}`,
        delay,
      });
      await scope.delay(delay);
    }
  }

  /**
   * Joins once the earlier channels have left, and resolves when this one
   * fails or closes. Resolves undefined when the scope dies first.
   */
  private async joinUntilEnd(
    scope: RunScope,
    topic: string,
  ): Promise<JoinEnd | undefined> {
    await this.leaving;
    if (!scope.alive) return undefined;
    try {
      await this.deps.transport.refreshAuth();
    } catch (cause) {
      return { kind: 'failed', subscribed: false, cause };
    }
    if (!scope.alive) return undefined;

    return new Promise((resolve) => {
      let ended = false;
      let subscribed = false;
      const end = (result: JoinEnd | undefined) => {
        ended = true;
        scope.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => end(undefined);
      scope.signal.addEventListener('abort', onAbort);

      this.channel = this.deps.transport.join(topic, {
        onBroadcast: (name, row) => {
          if (!ended) void this.emitWalletEvent(scope, name, row);
        },
        onStatus: (status, error) => {
          if (ended) return;
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            subscribed = true;
            this.report('connected');
            return;
          }
          end({
            kind:
              status === REALTIME_SUBSCRIBE_STATES.CLOSED ? 'closed' : 'failed',
            subscribed,
            cause: error ?? new Error(`Realtime channel ${status}`),
          });
        },
      });
    });
  }

  private leaveChannel(): void {
    const channel = this.channel;
    if (!channel) return;
    this.channel = undefined;
    this.leaving = Promise.allSettled([this.leaving, channel.leave()]).then(
      () => undefined,
    );
  }

  private async emitWalletEvent(
    scope: RunScope,
    name: string,
    row: unknown,
  ): Promise<void> {
    try {
      const pending = this.deps.toWalletEvent(name, row);
      if (!pending) {
        this.deps.logger.debug('Realtime event ignored', { event: name });
        return;
      }
      const message = await pending;
      if (scope.alive) this.deps.emit(message);
    } catch (cause) {
      if (scope.alive) {
        this.deps.logger.error('Realtime event mapping failed', {
          event: name,
          cause,
        });
      }
    }
  }

  /**
   * Emits `connection.changed`. Every `connected` goes out, because the host
   * refetches on each one; `reconnecting` and `error` go out only on a change.
   */
  private report(state: ConnectionState): void {
    if (state === this.reported && state !== 'connected') return;
    this.reported = state;
    this.deps.logger.debug('Realtime channel state changed', {
      topic: this.topic,
      state,
    });
    this.deps.emit({ event: 'connection.changed', payload: { state } });
  }
}

/**
 * Realtime change-feed for one SDK instance: one `wallet:<userId>` channel
 * per session. The facade exposes `open`, `close`, and `dispose`.
 */
export function createRealtimeFeed(deps: RealtimeFeedDeps): RealtimeFeed {
  const runtime = new RealtimeFeedRuntime(deps);
  return {
    open: () => runtime.open(),
    close: () => runtime.close(),
    dispose: () => runtime.dispose(),
  };
}
