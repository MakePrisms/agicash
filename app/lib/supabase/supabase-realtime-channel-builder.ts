import type {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  RealtimeChannel,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
} from '@supabase/realtime-js';
import type { SupabaseRealtimeManager } from './supabase-realtime-manager';

type ListenerCallback =
  | (() => void)
  | ((payload: RealtimePresenceJoinPayload<Record<string, unknown>>) => void)
  | ((payload: RealtimePresenceLeavePayload<Record<string, unknown>>) => void)
  | ((payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void)
  | ((payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => void)
  | ((payload: RealtimePostgresUpdatePayload<Record<string, unknown>>) => void)
  | ((payload: RealtimePostgresDeletePayload<Record<string, unknown>>) => void)
  | ((payload: {
      type: `${REALTIME_LISTEN_TYPES.BROADCAST}`;
      event: string;
      [key: string]: unknown;
    }) => void)
  | ((payload: unknown) => void);

/**
 * A builder for a Supabase Realtime channel.
 * It creates channel through SupabaseRealtimeManager.
 */
export class RealtimeChannelBuilder {
  private listeners: Array<{
    type: string;
    filter: Record<string, unknown> | { event: string };
    callback: ListenerCallback;
  }> = [];

  constructor(
    public readonly manager: SupabaseRealtimeManager,
    private readonly topicName: string,
  ) {}

  // RealtimeClient adds the "realtime:" prefix to the topic name in channel method so we have to add it here too.
  public get topic() {
    return `realtime:${this.topicName}`;
  }

  // These on overloads were based on the ones from @supabase/realtime-js RealtimeChannel
  on(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.SYNC}` },
    callback: () => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.JOIN}` },
    callback: (payload: RealtimePresenceJoinPayload<T>) => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.LEAVE}` },
    callback: (payload: RealtimePresenceLeavePayload<T>) => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL}`>,
    callback: (payload: RealtimePostgresChangesPayload<T>) => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT}`>,
    callback: (payload: RealtimePostgresInsertPayload<T>) => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE}`>,
    callback: (payload: RealtimePostgresUpdatePayload<T>) => void,
  ): this;
  on<T extends Record<string, unknown>>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.DELETE}`>,
    callback: (payload: RealtimePostgresDeletePayload<T>) => void,
  ): this;
  on(
    type: `${REALTIME_LISTEN_TYPES.BROADCAST}`,
    filter: { event: string },
    callback: (payload: {
      type: `${REALTIME_LISTEN_TYPES.BROADCAST}`;
      event: string;
      [key: string]: unknown;
    }) => void,
  ): this;
  on(
    type: `${REALTIME_LISTEN_TYPES.SYSTEM}`,
    filter: Record<string, never>,
    callback: (payload: unknown) => void,
  ): this;
  on(
    type: `${REALTIME_LISTEN_TYPES}`,
    filter: Record<string, unknown> | { event: string },
    callback: ListenerCallback,
  ): this {
    this.listeners.push({ type, filter, callback });
    return this;
  }

  /**
   * Creates the RealtimeChannel with all configured listeners
   */
  public build(): RealtimeChannel {
    const channel = this.manager.realtimeClient.channel(this.topicName);

    for (const { type, filter, callback } of this.listeners) {
      // biome-ignore lint/suspicious/noExplicitAny: we know the types are correct because of the overloads of on method defined above
      channel.on(type as any, filter as any, callback as any);
    }

    return channel;
  }
}
