type Listener<P> = (payload: P) => void;

/**
 * Minimal typed pub/sub. One bus per SDK instance. A throwing listener is
 * isolated (logged, not propagated) so one bad consumer cannot break delivery
 * to the rest or the emitting SDK operation.
 */
export class EventBus<EventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<
    keyof EventMap,
    Set<Listener<unknown>>
  >();

  on<E extends keyof EventMap>(
    event: E,
    cb: Listener<EventMap[E]>,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as Listener<unknown>);
    this.listeners.set(event, set);
    return () => {
      set.delete(cb as Listener<unknown>);
    };
  }

  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<EventMap[E]>)(payload);
      } catch (error) {
        console.error(`SDK event listener for "${String(event)}" threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
