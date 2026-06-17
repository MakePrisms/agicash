/**
 * A leader-only background processor. The ProcessorRegistry calls `reload` when
 * the processor's entity kind changes (or on catch-up), and `dispose` when
 * leadership is lost / background stops. Each processor owns its work-set fetch
 * (a bound WorkSetSource method) and narrows its own entity type internally.
 */
export type Processor = {
  /** Fetch the latest work set and (re)drive this processor's trackers / one-shot ops. */
  reload(userId: string): Promise<void>;
  /** Tear down trackers (unsubscribe NUT-17 WS / remove Breez listeners). */
  dispose(): void;
};
