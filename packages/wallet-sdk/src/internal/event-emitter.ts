import type { EventEmitter } from '../events';

type AnyHandler = (data: unknown) => void;

/**
 * In-memory typed event emitter. Implements the public read-only
 * {@link EventEmitter} surface (on/once) and adds an internal `emit` the SDK
 * uses to publish. Handlers are snapshotted per emit so a handler may
 * unsubscribe (incl. via `once`) mid-dispatch without skipping siblings.
 */
export class SdkEventEmitter<M> implements EventEmitter<M> {
  private readonly handlers = new Map<keyof M, Set<AnyHandler>>();

  on<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      set.delete(handler as AnyHandler);
      if (set.size === 0) this.handlers.delete(event);
    };
  }

  once<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void {
    const off = this.on(event, (data) => {
      off();
      handler(data);
    });
    return off;
  }

  emit<K extends keyof M>(event: K, data: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(data as unknown);
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
