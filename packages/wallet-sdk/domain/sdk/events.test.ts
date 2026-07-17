import { describe, expect, it } from 'bun:test';
import { nullLogger } from '../../lib/logger';
import { WalletEventEmitter } from './events';

describe('WalletEventEmitter', () => {
  it('delivers payloads to subscribed handlers', () => {
    const emitter = new WalletEventEmitter(nullLogger);
    const received: unknown[] = [];
    emitter.on('auth.session-expired', (payload) => received.push(payload));

    emitter.emit('auth.session-expired', {});

    expect(received).toEqual([{}]);
  });

  it('stops delivering after unsubscribe', () => {
    const emitter = new WalletEventEmitter(nullLogger);
    let calls = 0;
    const unsubscribe = emitter.on('auth.session-expired', () => {
      calls += 1;
    });

    unsubscribe();
    emitter.emit('auth.session-expired', {});

    expect(calls).toBe(0);
  });

  it('does not deliver the current emit to a handler subscribed mid-emit', () => {
    const emitter = new WalletEventEmitter(nullLogger);
    const order: string[] = [];
    let lateHandlerSubscribed = false;
    emitter.on('auth.session-expired', () => {
      order.push('first');
      if (!lateHandlerSubscribed) {
        lateHandlerSubscribed = true;
        emitter.on('auth.session-expired', () => {
          order.push('late');
        });
      }
    });

    emitter.emit('auth.session-expired', {});
    expect(order).toEqual(['first']);

    emitter.emit('auth.session-expired', {});
    expect(order).toEqual(['first', 'first', 'late']);
  });

  it('isolates a throwing handler and reports it to the logger', () => {
    const errors: string[] = [];
    const emitter = new WalletEventEmitter({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message) => {
        errors.push(message);
      },
    });
    let secondHandlerRan = false;
    emitter.on('auth.session-expired', () => {
      throw new Error('boom');
    });
    emitter.on('auth.session-expired', () => {
      secondHandlerRan = true;
    });

    emitter.emit('auth.session-expired', {});

    expect(secondHandlerRan).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
