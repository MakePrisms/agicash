import type { ChangeFeedChange } from './change-feed-router';

/**
 * Variant fan-out of a converted change-feed row. The base change-feed emits the
 * CORE lifecycle events (`send:*`/`receive:*`) and `connection:state` on its own
 * EventBus; THIS port is the variant-specific fan-out the base only declares:
 * variant A emits row-level entity events (`<entity>:created|updated|deleted`),
 * variant B writes its stores. No base implementation.
 */
export type EntityFanout = {
  /** Fan out one converted row change. A: emit the row event; B: upsert the store. */
  emit(change: ChangeFeedChange): void;
  /**
   * Connection (re)established and caught up. A: emit the A-only `connection:resync`
   * (it is not on the core EventMap, so it can only originate here); B: refetch stores.
   */
  onCatchUp(): void;
};

/**
 * Processor trigger. The change-feed signals the background processors that a
 * relevant entity changed (per row) or that the connection caught up (reload all
 * work sets). Plan 4c wires the concrete six processors; the base only declares it.
 */
export type ProcessorTrigger = {
  /** A relevant entity changed — (re)evaluate the matching processor for it. */
  onEntityChange(change: ChangeFeedChange): void;
  /** Connection (re)established — reload work sets (the caught-up snapshot may differ). */
  onCatchUp(): void;
};
