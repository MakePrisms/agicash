/**
 * Typed event emitter — the runtime backing for §11's `EventEmitter<M>` interface.
 * FULLY NET-NEW (no master EventEmitter to lift).
 *
 * The PUBLIC contract (`EventEmitter<M>` in `../events`) exposes only `on` / `once`
 * (subscribe). This class implements that interface and ADDS the internal
 * `emit` / `off` the SDK needs to publish events (from domains + the realtime
 * forwarder). The `Sdk` exposes the instance typed as the narrow public
 * `EventEmitter<SdkEventMap>`, so consumers cannot `emit`.
 *
 * Framework-free: a plain `Map<key, Set<handler>>`, no DOM `EventTarget`, no deps.
 * @module
 */
import type { EventEmitter } from '../events';

/** A handler for event `K` of map `M`. */
type Handler<M, K extends keyof M> = (data: M[K]) => void;

/**
 * Concrete typed emitter. `M` is the event map (e.g. `SdkEventMap`); keys are event
 * names and each value is that event's payload type.
 */
export class TypedEventEmitter<M> implements EventEmitter<M> {
  /**
   * event name -> set of handlers. `Set` gives O(1) add/remove and natural dedupe
   * (registering the same handler reference twice subscribes it once). Typed loosely
   * here (`keyof M` payloads are heterogeneous); the public methods re-impose the
   * per-key type at the call site.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous payloads across keys; the public on/once/emit signatures restore per-key typing.
  private readonly handlers = new Map<keyof M, Set<Handler<M, any>>>();

  /**
   * Subscribe to `event`. Returns an unsubscribe function (idempotent — calling it
   * more than once is a no-op).
   *
   * @param event - the event name (a key of `M`).
   * @param handler - invoked with the event payload on every emit.
   * @returns a function that removes this handler.
   */
  on<K extends keyof M>(event: K, handler: Handler<M, K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to `event` for a SINGLE emission, then auto-unsubscribe. Returns an
   * unsubscribe function so the caller can cancel before the event ever fires.
   *
   * @param event - the event name (a key of `M`).
   * @param handler - invoked once with the next event payload, then removed.
   * @returns a function that removes the one-shot handler early.
   */
  once<K extends keyof M>(event: K, handler: Handler<M, K>): () => void {
    const wrapper: Handler<M, K> = (data) => {
      // unsubscribe BEFORE invoking so a handler that re-emits the same event does
      // not re-enter this one-shot wrapper.
      off();
      handler(data);
    };
    const off = this.on(event, wrapper);
    return off;
  }

  /**
   * Remove a previously-registered handler. No-op if it was never registered.
   *
   * @param event - the event name.
   * @param handler - the exact handler reference passed to `on`/`once`.
   */
  off<K extends keyof M>(event: K, handler: Handler<M, K>): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Publish `event` to all current subscribers. INTERNAL — not on the public
   * `EventEmitter<M>` interface. A snapshot of the handler set is iterated so a
   * handler that unsubscribes (or subscribes) during dispatch does not disturb the
   * in-flight loop. Handler exceptions are isolated (one throwing handler does not
   * prevent the rest from running) and re-surfaced asynchronously so they are not
   * swallowed.
   *
   * @param event - the event name.
   * @param data - the payload for `event`.
   */
  emit<K extends keyof M>(event: K, data: M[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) {
      return;
    }
    for (const handler of [...set]) {
      try {
        handler(data);
      } catch (error) {
        // Isolate: never let one bad subscriber break event delivery to the others.
        // Re-throw out-of-band so the failure is still observable (unhandled rejection)
        // rather than silently dropped.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Remove ALL handlers (every event). Used by `Sdk.destroy()` to drop subscriber
   * references on teardown.
   */
  removeAllListeners(): void {
    this.handlers.clear();
  }
}
