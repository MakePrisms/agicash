import type { Logger, WalletEventMap, WalletEvents } from '../sdk';

type Handler = (payload: never) => void;

export class WalletEventEmitter implements WalletEvents {
  private readonly handlers = new Map<keyof WalletEventMap, Set<Handler>>();

  constructor(private readonly logger: Logger) {}

  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as Handler);
    };
  }

  emit<K extends keyof WalletEventMap>(
    event: K,
    payload: WalletEventMap[K],
  ): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    // Snapshot: a handler that (un)subscribes mid-emit must not change the
    // current dispatch.
    for (const handler of [...set]) {
      try {
        (handler as (payload: WalletEventMap[K]) => void)(payload);
      } catch (error) {
        this.logger.error(`Event handler for ${event} threw`, error);
      }
    }
  }
}
