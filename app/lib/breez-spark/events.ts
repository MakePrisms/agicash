import type {
  EventListener,
  SdkEvent,
} from '@breeztech/breez-sdk-spark/bundler';

export type EventLogEntry = {
  timestamp: Date;
  eventType: SdkEvent['type'];
  data: SdkEvent;
};

export type OnEventCallback = (entry: EventLogEntry) => void;

/**
 * Creates an EventListener object compatible with the Breez SDK interface.
 * Pass the returned listener to `sdk.addEventListener(listener)` to subscribe.
 *
 * Each incoming SDK event is wrapped in an EventLogEntry with a timestamp and
 * forwarded to `onEvent`.
 *
 * @example
 * const listener = createEventListener((entry) => console.log(entry));
 * const listenerId = await sdk.addEventListener(listener);
 * // later:
 * await sdk.removeEventListener(listenerId);
 */
export function createEventListener(onEvent: OnEventCallback): EventListener {
  return {
    onEvent(e: SdkEvent): void {
      const entry: EventLogEntry = {
        timestamp: new Date(),
        eventType: e.type,
        data: e,
      };
      onEvent(entry);
    },
  };
}
