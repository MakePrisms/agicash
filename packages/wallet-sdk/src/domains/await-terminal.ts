import type { Money } from '@agicash/money';
import { DomainError, type SdkError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';

/** The successful terminal result of a send/receive flow. */
export type TerminalResult = {
  protocol: 'cashu' | 'spark';
  quoteId: string;
  transactionId: string;
  amount: Money;
};

/** A freshly-read entity classified for the awaitTerminal backstop. */
export type TerminalStatus =
  | { status: 'completed'; result: TerminalResult }
  | { status: 'failed'; error: SdkError }
  | { status: 'expired' }
  | { status: 'pending' };

/**
 * Resolves when the entity identified by `quoteId` reaches a terminal state.
 *
 * Listens on the base lifecycle events (`send:*` / `receive:*`), which fire once
 * per entity, on every instance, while background processing is running — AND
 * does one immediate `backstop` read to catch an entity that was already terminal
 * before the listener attached (events do not replay). Resolves with the
 * `TerminalResult` on success; rejects with the `SdkError` on failure, or a
 * `DomainError` on expiry/abort.
 *
 * @remarks Requires `sdk.background.start()`: lifecycle events derive from the
 * realtime change-feed. Not used by server mode (which has no engine).
 */
export function awaitTerminal(deps: {
  events: EventBus<SdkCoreEventMap>;
  /** `send` listens on send:completed/failed; `receive` adds receive:expired. */
  kind: 'send' | 'receive';
  quoteId: string;
  /** Re-reads + classifies the entity; `pending` keeps waiting for an event. */
  backstop: () => Promise<TerminalStatus>;
  signal?: AbortSignal;
}): Promise<TerminalResult> {
  const { events, kind, quoteId, backstop, signal } = deps;

  return new Promise<TerminalResult>((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    let settled = false;

    const onAbort = () =>
      done(() =>
        reject(new DomainError('Aborted while awaiting terminal state')),
      );

    const cleanup = () => {
      for (const off of unsubs) off();
      signal?.removeEventListener('abort', onAbort);
    };

    function done(fn: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    }

    if (signal?.aborted) {
      reject(new DomainError('Aborted while awaiting terminal state'));
      return;
    }
    signal?.addEventListener('abort', onAbort);

    const matches = (p: { quoteId: string }) => p.quoteId === quoteId;

    if (kind === 'send') {
      unsubs.push(
        events.on('send:completed', (p) => {
          if (matches(p)) done(() => resolve(p));
        }),
        events.on('send:failed', (p) => {
          if (matches(p)) done(() => reject(p.error));
        }),
      );
    } else {
      unsubs.push(
        events.on('receive:completed', (p) => {
          if (matches(p)) done(() => resolve(p));
        }),
        events.on('receive:failed', (p) => {
          if (matches(p)) done(() => reject(p.error));
        }),
        events.on('receive:expired', (p) => {
          if (matches(p)) done(() => reject(new DomainError('Quote expired')));
        }),
      );
    }

    // Events do not replay on attach — catch an already-terminal entity.
    backstop().then(
      (s) => {
        if (s.status === 'completed') done(() => resolve(s.result));
        else if (s.status === 'failed') done(() => reject(s.error));
        else if (s.status === 'expired')
          done(() => reject(new DomainError('Quote expired')));
        // 'pending' → keep the listeners armed.
      },
      (err) => done(() => reject(err)),
    );
  });
}
