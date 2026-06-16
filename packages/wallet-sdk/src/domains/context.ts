import type { SdkConfig } from '../config';
import type { SdkEventMap } from '../events';
import type { SdkConnections } from '../internal/connections';
import type { SdkEventEmitter } from '../internal/event-emitter';

/** Dependencies every domain implementation receives from the `Sdk`. */
export type DomainContext = {
  config: SdkConfig;
  connections: SdkConnections;
  emitter: SdkEventEmitter<SdkEventMap>;
};
