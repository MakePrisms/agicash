import type { SupabaseRealtimeManager } from '../../lib/supabase/supabase-realtime-manager';
import type { DatabaseChangeHandler } from './database-change-handler';

export type RealtimeHandlerConfig = {
  realtimeManager: SupabaseRealtimeManager;
  handlers: DatabaseChangeHandler[];
  userId: string;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
};

export class RealtimeHandler {
  private channelTopic: string | undefined;
  private started = false;

  constructor(private readonly config: RealtimeHandlerConfig) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    const channelBuilder = this.config.realtimeManager
      .channel(`wallet:${this.config.userId}`, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        const handler = this.config.handlers.find((h) => h.event === event);
        if (!handler) {
          return;
        }

        try {
          const result = handler.handleEvent(payload);
          if (result instanceof Promise) {
            result.catch((error) => {
              this.config.onError?.(error);
            });
          }
        } catch (error) {
          this.config.onError?.(error);
        }
      });

    // channelBuilder.topic includes the realtime: prefix required by
    // subscribe() and removeChannel() for map lookups.
    this.channelTopic = channelBuilder.topic;

    this.config.realtimeManager.addChannel(channelBuilder);
    await this.config.realtimeManager.subscribe(
      this.channelTopic,
      this.config.onConnected,
    );
  }

  async stop(): Promise<void> {
    if (!this.started || !this.channelTopic) {
      return;
    }

    this.started = false;
    await this.config.realtimeManager.removeChannel(this.channelTopic, {
      onConnected: this.config.onConnected,
    });
    this.channelTopic = undefined;
  }
}
