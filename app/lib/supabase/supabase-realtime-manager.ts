import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimeClient,
} from '@supabase/supabase-js';
import { SupabaseRealtimeChannel } from './supabase-realtime-channel';
import { RealtimeChannelBuilder } from './supabase-realtime-channel-builder';

export type ChannelStatus =
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'closed'
  | 'error'
  | 'reconnecting';

interface ChannelState {
  /**
   * The builder that was used to create the channel.
   */
  channelBuilder: RealtimeChannelBuilder;
  /**
   * The channel instance.
   */
  channel: RealtimeChannel;
  /**
   * Current status of the channel.
   */
  status: ChannelStatus;
  /**
   * The last error for the channel, if any.
   */
  error?: Error;
  /**
   * The timeout for the currently scheduled resubscribe retry, if any.
   */
  retryTimeout?: ReturnType<typeof setTimeout>;
  /**
   * Callbacks that are called when the channel is initially connected or reconnected.
   */
  onConnectedCallbacks: Set<() => void>;
  /**
   * The number of active subscribers to this channel.
   */
  subscribersCount: number;
}

interface ResubscribeQueueItem {
  channelTopic: string;
}

function logDebug(message: string, data: Record<string, unknown>): void {
  const now = Date.now();
  console.debug(message, {
    timestamp: now,
    time: new Date(now).toISOString(),
    ...data,
  });
}

/**
 * A manager for Supabase Realtime channels.
 *
 * This is an abstraction on top of the Supabase Realtime client. It was added because:
 *
 * a) Supabase client handles errors and reconnects very poorly. We had a bunch of issues with it where the cannel would just error or timeout when:
 *     - The app goes offline and back online
 *     - The tab goes inactive and then active again on desktop devices
 *     - The app goes to the background and then back to the foreground on mobile devices
 *     - The device goes to sleep and then wakes up
 *     - ...
 *
 * b) Supabase client doesn't have a way to get the missed updates. That means that each time the app is running again, and the channel is fully
 *    connected, we need to fetch the missed updates from the server. However, Supabase client doesn't have an easy way to wait for subscription
 *    to be established nor to notify when the connection is fully established. Its subscribe method is synchronous and has a callback but the
 *    callback doesn't take into account the full database connection being established (see comment about postgres_changes ok message below).
 *
 * The idea of the manager is to:
 *   - Provide a way to get notified each time the channel is fully connected (initially or after a reconnect).
 *   - Detect errors and timeouts when app is active and online and try to resolve them with retries (each retry removes and creates the channel again)
 *     that have exponential backoff. Only if all of the retries fail, the channel status is set to 'error'.
 *   - Detect error and timeouts when app is inactive or offline and unsubscribe the channel. Then when the app becomes active and online again,
 *     resubcribe the channel.
 *
 * The manager can handle multiple subscribers to the same channel. It tracks the number of active subscribers to determine when to remove the channel from the manager.
 *
 * Resubcribe retry uses a queue to ensure that only one resubscribe is in progress at a time. So if channel A and B error in the same time,
 * they will be retried one after the other. So B will wait in the queue until A has been reconnected or all retries have failed. The reason
 * we did it this way is because when we initially allowed resubscription to be happening in parallel for multiple channels, sometimes all
 * resubscriptions would just fail and we suspected it might be caused by too many concurrent messages being shared of the the socket (Supabase client
 * use one socket for all channels).
 */
export class SupabaseRealtimeManager {
  private isOnline = true;
  private isActive = true;
  private channels = new Map<string, ChannelState>();
  private resubscribeQueue: ResubscribeQueueItem[] = [];
  private isProcessingResubscribeQueue = false;
  private readonly millisecondRetryDelays = [
    0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000,
  ];
  private readonly maxRetries = this.millisecondRetryDelays.length;
  private readonly topicListeners = new Map<string, Set<() => void>>();
  private readonly subcribeCallbacks = new Map<
    string,
    (status: REALTIME_SUBSCRIBE_STATES, err?: Error) => void
  >();

  private get isOfflineOrInactive(): boolean {
    return !this.isOnline || !this.isActive;
  }

  constructor(public readonly realtimeClient: RealtimeClient) {}

  /**
   * Creates a channel builder for configuring a realtime channel
   * @param topicName The channel topic name
   * @param config Optional channel configuration
   * @returns A builder for configuring a realtime channel
   */
  public channel(
    topicName: string,
    config?: { private?: boolean },
  ): RealtimeChannelBuilder {
    return new RealtimeChannelBuilder(this, topicName, config);
  }

  /**
   * Creates a realtime channel and adds it to the manager in the idle status
   * If the channel is already added to the manager, returns the existing channel.
   * @param channelBuilder A builder that creates a realtime channel
   * @returns The added channel
   */
  public addChannel(
    channelBuilder: RealtimeChannelBuilder,
  ): SupabaseRealtimeChannel {
    const existingChannel = this.channels.get(channelBuilder.topic);
    if (existingChannel) {
      return new SupabaseRealtimeChannel(this, existingChannel.channel);
    }

    const channel = channelBuilder.build();
    const channelState: ChannelState = {
      channelBuilder,
      channel,
      status: 'idle',
      subscribersCount: 0,
      onConnectedCallbacks: new Set(),
    };
    this.channels.set(channel.topic, channelState);
    return new SupabaseRealtimeChannel(this, channel);
  }

  /**
   * Subscribes to a realtime channel
   * It throws if the channel with provided topic was not added to the manager before.
   * If the channel is already subscribed, subscribing, or reconnecting, it just registers the onConnected callback.
   * @param channelTopic The topic of the channel to subscribe to
   * @param onConnected A callback that is called when the channel is initially connected or reconnected. Use if you need to refresh the data to catch up with the latest changes.
   * @returns A promise that resolves when the channel is subscribed or the subscription fails.
   */
  public async subscribe(
    channelTopic: string,
    onConnected?: () => void,
  ): Promise<void> {
    const state = this.channels.get(channelTopic);
    if (!state) {
      throw new Error(`Channel ${channelTopic} not found`);
    }

    if (onConnected) {
      state.onConnectedCallbacks.add(onConnected);
    }

    state.subscribersCount++;

    await this.subscribeToChannel(state);
  }

  /**
   * Unsubscribes and removes a single channel from the Supabase realtime client.
   * Uses reference counting - only actually removes the channel when subscribersCount reaches 0.
   * @param channelTopic The topic of the channel to remove
   * @param options Options for the removal
   * @returns A promise that resolves when the channel is removed
   */
  public async removeChannel(
    channelTopic: string,
    options?: {
      /**
       * The onConnected callback to remove from the set when unsubscribing.
       */
      onConnected?: () => void;
    },
  ): Promise<void> {
    const state = this.channels.get(channelTopic);

    logDebug('Realtime channel remove called', {
      topic: channelTopic,
      subscribersCount: state?.subscribersCount,
      socketConnectionState: state?.channel.socket.connectionState().toString(),
    });

    if (!state) {
      logDebug('Realtime channel remove did not find the channel', {
        topic: channelTopic,
      });
      return;
    }

    if (options?.onConnected) {
      state.onConnectedCallbacks.delete(options.onConnected);
    }
    state.subscribersCount--;

    if (state.subscribersCount > 0) {
      logDebug(
        'Realtime channel has more active subscribers so it will not be removed',
        {
          topic: channelTopic,
          subscribersCount: state.subscribersCount,
          socketConnectionState: state?.channel.socket
            .connectionState()
            .toString(),
        },
      );
      return;
    }

    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }

    this.resubscribeQueue = this.resubscribeQueue.filter(
      (item) => item.channelTopic !== state.channel.topic,
    );

    // Delete from maps first to prevent addChannel from reusing this channel
    // during the async removeChannel operation
    this.channels.delete(channelTopic);
    this.subcribeCallbacks.delete(channelTopic);
    this.topicListeners.delete(channelTopic);

    // removeChannel never throws - it always resolves with 'ok' | 'timed out' | 'error'
    // Even on error/timeout, the channel is cleaned up on the client side, so we proceed
    const result = await this.realtimeClient.removeChannel(state.channel);

    logDebug('Realtime channel remove result', {
      topic: channelTopic,
      result,
      socketConnectionState: state.channel.socket.connectionState().toString(),
    });
  }

  /**
   * Gets the current status of a channel
   * @param channelTopic The topic of the channel to get the status for
   * @returns The status of the channel or undefined if the channel is not added to the manager
   */
  public getChannelStatus(channelTopic: string): ChannelStatus | undefined {
    return this.channels.get(channelTopic)?.status;
  }

  /**
   * Returns the last error for a channel, if any.
   * @param channelTopic The topic of the channel to get the error for
   * @returns The last error for the channel or undefined if there is no error or the channel is not added to the manager
   */
  public getChannelError(channelTopic: string): Error | undefined {
    return this.channels.get(channelTopic)?.error;
  }

  /**
   * Subscribes to status changes for a specific channel.
   * @param topic The topic of the channel to subscribe to
   * @param listener A callback that is called when the status of the channel changes
   * @returns A function that can be called to unsubscribe from the status changes
   */
  public subscribeToChannelStatusChange(
    topic: string,
    listener: () => void,
  ): () => void {
    const setForTopic = this.topicListeners.get(topic) ?? new Set<() => void>();
    setForTopic.add(listener);
    this.topicListeners.set(topic, setForTopic);

    return () => {
      const listeners = this.topicListeners.get(topic);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.topicListeners.delete(topic);
      }
    };
  }

  /**
   * Schedules a resubscribe for a channel if it's not already being retried or scheduled.
   * Resubscribe has auto retry logic with exponential backoff built in. Only one channel can be trying to resubscribe at a time.
   * If resubscribe is already in progress for channel A when this method is called for channel B, the B will be added to the queue
   * and processed only after A has been resubscribed or all retries have failed.
   * @param channelTopic The topic of the channel to resubscribe
   */
  public resubscribe(channelTopic: string): void {
    const state = this.channels.get(channelTopic);
    if (!state) return;

    const alreadyScheduledForResubscribe = this.resubscribeQueue.some(
      (item) => item.channelTopic === channelTopic,
    );

    logDebug('Realtime channel resubscribe called', {
      topic: channelTopic,
      alreadyScheduledForResubscribe,
    });

    if (alreadyScheduledForResubscribe) {
      return;
    }

    this.resubscribeQueue.push({ channelTopic });
    this.updateChannelStatus(channelTopic, 'reconnecting');

    this.processResubscribeQueue();
  }

  /**
   * Sets the online status of the app.
   * If the app is online and active, it will resubscribe all inactive channels.
   * @param isOnline The online status of the app
   */
  public setOnlineStatus(isOnline: boolean): void {
    if (this.isOnline === isOnline) {
      return;
    }

    this.isOnline = isOnline;

    logDebug('Realtime manager online status updated', {
      isOnline: this.isOnline,
      isActive: this.isActive,
      socketConnectionReadyState: this.realtimeClient.conn?.readyState,
    });

    if (this.isOnline && this.isActive) {
      this.resubscribeInactiveChannels();
    }
  }

  /**
   * Sets the active status of the app.
   * App is active when in foreground on mobile devices and when the tab is active on desktop devices.
   * @param isActive The active status of the app
   */
  public setActiveStatus(isActive: boolean): void {
    if (this.isActive === isActive) {
      return;
    }

    this.isActive = isActive;

    logDebug('Realtime manager active status updated', {
      isActive: this.isActive,
      isOnline: this.isOnline,
      socketConnectionReadyState: this.realtimeClient.conn?.readyState,
    });

    if (this.isActive && this.isOnline) {
      this.resubscribeInactiveChannels();
    }
  }

  /**
   * Closes a channel temporarily without removing it from the manager.
   * Used when app goes offline or inactive. The channel can be resubscribed later.
   * Cancels any pending retries and sets status to 'closed'.
   * Does NOT decrement subscribersCount since this is internal cleanup.
   * @param channelTopic The topic of the channel to close
   * @returns A promise that resolves when the channel is closed
   */
  private async closeChannel(channelTopic: string): Promise<void> {
    const state = this.channels.get(channelTopic);
    if (!state) return;

    logDebug('Realtime channel close called', {
      topic: channelTopic,
      subscribersCount: state.subscribersCount,
      socketConnectionState: state.channel.socket.connectionState().toString(),
    });

    // Cancel any pending retries since we're closing
    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }

    this.resubscribeQueue = this.resubscribeQueue.filter(
      (item) => item.channelTopic !== state.channel.topic,
    );

    await this.realtimeClient.removeChannel(state.channel);
    this.updateChannelStatus(channelTopic, 'closed');

    logDebug('Realtime channel close result', {
      topic: channelTopic,
      socketConnectionState: state.channel.socket.connectionState().toString(),
    });
  }

  /**
   * Refreshes the realtime client access token if it has expired.
   */
  private async refreshSessionIfNeeded(): Promise<void> {
    // setAuth calls accessToken method on the Supabase client which fetches the existing token if still valid or fetches a new one if expired.
    // It then sees if the token returned from accessToken method has changed and if it did, it updates the realtime access token.
    await this.realtimeClient.setAuth();
  }

  /**
   * Calls resubscribe for all channels that are not subscribed or subscribing.
   */
  private resubscribeInactiveChannels(): void {
    const inactiveChannels = Array.from(this.channels.values()).filter(
      (channelState) =>
        channelState.status !== 'subscribed' &&
        channelState.status !== 'subscribing' &&
        channelState.status !== 'reconnecting',
    );

    if (inactiveChannels.length > 0) {
      logDebug('Realtime manager will call resubscribe for inactive channels', {
        numberOfInactiveChannels: inactiveChannels.length,
        inactiveChannels: inactiveChannels
          .map((channelState) => channelState.channel.topic)
          .toString(),
      });
    }

    for (const { channel } of inactiveChannels) {
      this.resubscribe(channel.topic);
    }
  }

  /**
   * Processes the resubscribe queue. If the processing is already in progress, it is a no-op, otherwise it reads the first item from the queue and
   * tries to resubscribe it. If the resubscribe fails, it is retried up to maxRetries times with exponential backoff. Once the processing is done
   * for the first item (all retries have failed or the channel is subscribed again), the item is removed from the queue and the method recursively
   * calls itself to process the next item.
   * If the channel has not been subscribed after all retries, the status of the channel is set to 'error'.
   */
  private async processResubscribeQueue(): Promise<void> {
    if (this.isProcessingResubscribeQueue || this.resubscribeQueue.length === 0)
      return;

    this.isProcessingResubscribeQueue = true;

    const item = this.resubscribeQueue[0];
    let attempt = 1;

    for (; attempt <= this.maxRetries; attempt++) {
      const state = this.channels.get(item.channelTopic);

      if (!state || state.status === 'subscribed') {
        break;
      }

      const delay = this.millisecondRetryDelays[attempt - 1];

      logDebug('Realtime channel scheduled resubscribe attempt', {
        topic: item.channelTopic,
        status: state.status,
        error: state.error,
        socketConnectionState: state.channel.socket
          .connectionState()
          .toString(),
        attempt: `${attempt}/${this.maxRetries}`,
        delay,
      });

      await new Promise((resolve) => {
        state.retryTimeout = setTimeout(resolve, delay);
      });

      logDebug('Realtime channel will attempt resubscribe', {
        topic: item.channelTopic,
        status: state.status,
        error: state.error,
        socketConnectionState: state.channel.socket
          .connectionState()
          .toString(),
        attempt: `${attempt}/${this.maxRetries}`,
      });

      await this.resubscribeToChannel(item.channelTopic);
    }

    this.resubscribeQueue.shift();

    const state = this.channels.get(item.channelTopic);

    if (state && state.status !== 'subscribed') {
      this.updateChannelStatus(item.channelTopic, 'error');
    }

    logDebug('Realtime channel resubscribe retries finished', {
      topic: item.channelTopic,
      hasResubscribed: state?.status === 'subscribed',
      attempts: `${attempt - 1}/${this.maxRetries}`,
    });

    this.isProcessingResubscribeQueue = false;

    if (this.resubscribeQueue.length > 0) {
      this.processResubscribeQueue();
    }
  }

  /**
   * Resubscribes to a channel by removing the channel from the Supabase realtime client and then adding it back.
   * @param channelTopic The topic of the channel to resubscribe to
   */
  private async resubscribeToChannel(channelTopic: string): Promise<void> {
    const state = this.channels.get(channelTopic);
    if (!state) return;

    await this.realtimeClient.removeChannel(state.channel);

    // Rebuild the channel in place without changing subscribersCount or callbacks
    const newChannel = state.channelBuilder.build();
    state.channel = newChannel;

    await this.subscribeToChannel(state);
  }

  /**
   * Subscribes to a realtime channel.
   * It is a no-op if the channel is already subscribed, subscribing, or reconnecting.
   * @param state The state of the channel to subscribe to
   * @returns A promise that resolves when the channel is subscribed
   */
  private async subscribeToChannel(state: ChannelState): Promise<void> {
    if (
      state.status === 'subscribed' ||
      state.status === 'subscribing' ||
      state.status === 'reconnecting'
    ) {
      return;
    }

    const channelTopic = state.channel.topic;

    this.updateChannelStatus(channelTopic, 'subscribing');

    await this.refreshSessionIfNeeded();

    const channel = state.channel;

    await new Promise<void>((resolve) => {
      logDebug('Realtime channel subscribe called', {
        topic: channel.topic,
        socketConnectionState: channel.socket.connectionState().toString(),
      });

      const subscribeCallback = (
        status: REALTIME_SUBSCRIBE_STATES,
        error?: Error,
      ) => {
        logDebug('Realtime channel subscription status changed', {
          topic: channel.topic,
          status,
          socketConnectionState: channel.socket.connectionState().toString(),
          error,
        });

        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          this.updateChannelStatus(channelTopic, 'subscribed');
          state.error = undefined;
          resolve();

          for (const callback of state.onConnectedCallbacks) {
            try {
              callback();
            } catch (error) {
              console.error('Error calling onConnected callback', {
                error,
                topic: channel.topic,
              });
            }
          }
        } else {
          resolve();

          if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
            this.updateChannelStatus(channelTopic, 'closed');
          } else if (
            status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
          ) {
            if (this.isOfflineOrInactive) {
              const event =
                status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR
                  ? 'error'
                  : 'timeout';
              logDebug(
                `Realtime channel ${event}, but tab is not active or app is offline. Unsubscribing.`,
                {
                  topic: channelTopic,
                  status,
                  error,
                  socketConnectionState: channel.socket
                    .connectionState()
                    .toString(),
                },
              );
              // Keep state so closed channel can be detected and resubscribed when app becomes online and active again
              this.closeChannel(channelTopic);
              return;
            }

            state.error =
              error ??
              new Error(
                `Error with "${channel.topic}" channel subscription. Status: ${status}`,
              );
            this.resubscribe(channelTopic);
          }
        }
      };

      channel.subscribe(subscribeCallback);
      this.subcribeCallbacks.set(channelTopic, subscribeCallback);
    });
  }

  /**
   * Notifies all the registered listeners for a specific channel topic that the status has changed.
   * @param channelTopic The topic of the channel to notify the status change for
   */
  private notifyStatusChange(channelTopic: string): void {
    const setForTopic = this.topicListeners.get(channelTopic);
    if (setForTopic) {
      for (const listener of setForTopic) {
        try {
          listener();
        } catch (error) {
          console.error('Error calling listener', {
            error,
            topic: channelTopic,
          });
        }
      }
    }
  }

  /**
   * Updates the status of a channel and notifies the listeners if the status has changed.
   * @param channelTopic The topic of the channel to update the status for
   * @param status The new status of the channel
   */
  private updateChannelStatus(
    channelTopic: string,
    status: ChannelStatus,
  ): void {
    const state = this.channels.get(channelTopic);
    if (!state) return;

    if (state.status !== status) {
      state.status = status;
      this.notifyStatusChange(channelTopic);
    }
  }

  /**
   * Simulates a channel status change for a specific channel.
   * Use only for testing purposes.
   * @internal
   * @param channelTopic The topic of the channel to simulate the status change for
   * @param status The new status of the channel
   * @param error The error for the channel, if any
   */
  private simulateChannelStatusChange(
    channelTopic: string,
    status: REALTIME_SUBSCRIBE_STATES,
    error?: Error,
  ): void {
    const subscribeCallback = this.subcribeCallbacks.get(channelTopic);
    if (!subscribeCallback) {
      return;
    }

    subscribeCallback(status, error);
  }
}
