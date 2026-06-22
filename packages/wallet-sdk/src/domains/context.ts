import type { SdkConfig } from '../config';
import type { SdkEventMap } from '../events';
import type { SdkConnections } from '../internal/connections';
import type { SdkEventEmitter } from '../internal/event-emitter';

/** Dependencies every domain implementation receives from the `Sdk`. */
export type DomainContext = {
  config: SdkConfig;
  connections: SdkConnections;
  emitter: SdkEventEmitter<SdkEventMap>;
  /**
   * Internal test seam — injected only in unit tests to avoid real timer delays.
   * Never set in production code; defaults to `setTimeout`-based sleep in domain
   * functions that need it.
   */
  _sleep?: (ms: number) => Promise<void>;
};
