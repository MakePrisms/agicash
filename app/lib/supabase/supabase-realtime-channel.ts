import type { RealtimeChannel } from '@supabase/realtime-js';
import type { SupabaseRealtimeManager } from './supabase-realtime-manager';

/**
 * A wrapper around Supabase RealtimeChannel subcribes and unsubscribes from the channel through the realtime manager.
 */
export class SupabaseRealtimeChannel {
  constructor(
    public readonly channelManager: SupabaseRealtimeManager,
    private readonly underlyingChannel: RealtimeChannel,
  ) {}

  /**
   * Gets the topic of the channel
   */
  public get topic(): string {
    return this.underlyingChannel.topic;
  }

  /**
   * Subscribes to the channel through the manager.
   * @param onConnected A callback that is called when the channel is initially connected or reconnected.
   * @returns A promise that resolves when the channel is subscribed or the subscription fails.
   */
  public async subscribe(onConnected?: () => void): Promise<void> {
    await this.channelManager.subscribe(this.topic, onConnected);
  }

  /**
   * Unsubscribes from the channel and removes it from the manager.
   * @returns A promise that resolves when the channel is unsubscribed.
   */
  public async unsubscribe(): Promise<void> {
    await this.channelManager.removeChannel(this.topic);
  }
}
