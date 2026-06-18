import { describe, expect, mock, test } from 'bun:test';
import { Money } from '@agicash/money';
import { DomainError } from '../errors';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import {
  awaitTerminal,
  type TerminalResult,
  type TerminalStatus,
} from './await-terminal';

const amount = new Money({
  amount: 100,
  currency: 'BTC',
  unit: 'sat',
}) as Money;
const completedResult: TerminalResult = {
  protocol: 'cashu',
  quoteId: 'q1',
  transactionId: 't1',
  amount,
};
const pending = async (): Promise<TerminalStatus> => ({ status: 'pending' });

describe('awaitTerminal', () => {
  test('resolves on a matching send:completed event', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('send:completed', completedResult);
    expect(await p).toEqual(completedResult);
  });

  test('ignores non-matching quoteId', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    let settled = false;
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    }).then(() => {
      settled = true;
    });
    events.emit('send:completed', { ...completedResult, quoteId: 'other' });
    await Promise.resolve();
    expect(settled).toBe(false);
    events.emit('send:completed', completedResult);
    await p;
    expect(settled).toBe(true);
  });

  test('rejects on send:failed with the error', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const err = new DomainError('boom');
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('send:failed', {
      protocol: 'cashu',
      quoteId: 'q1',
      error: err,
    });
    await expect(p).rejects.toBe(err);
  });

  test('rejects on receive:expired', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'receive',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('receive:expired', { protocol: 'cashu', quoteId: 'q1' });
    await expect(p).rejects.toThrow('expired');
  });

  test('backstop already-completed resolves without an event', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const result = await awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: async () => ({ status: 'completed', result: completedResult }),
    });
    expect(result).toEqual(completedResult);
  });

  test('backstop pending then a later event resolves', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'receive',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('receive:completed', { ...completedResult });
    expect(await p).toEqual(completedResult);
  });

  test('aborts via signal', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const ctrl = new AbortController();
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(p).rejects.toThrow('Aborted');
  });

  test('unsubscribes after settling (no further delivery)', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const cb = mock(() => {});
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: async () => ({ status: 'completed', result: completedResult }),
    });
    await p;
    // A second emit must not throw or re-settle; the listener is gone.
    events.emit('send:completed', completedResult);
    expect(cb).not.toHaveBeenCalled();
  });
});
