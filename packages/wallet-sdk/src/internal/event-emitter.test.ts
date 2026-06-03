import { describe, expect, test } from 'bun:test';
import { TypedEventEmitter } from './event-emitter';

/** A small event map for exercising the emitter. */
type TestEventMap = {
  ping: { n: number };
  pong: { label: string };
};

describe('TypedEventEmitter', () => {
  test('on + emit delivers the payload to the handler', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const received: Array<{ n: number }> = [];

    ee.on('ping', (data) => received.push(data));
    ee.emit('ping', { n: 1 });

    expect(received).toEqual([{ n: 1 }]);
  });

  test('on stays subscribed across multiple emits', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];

    ee.on('ping', (data) => seen.push(data.n));
    ee.emit('ping', { n: 1 });
    ee.emit('ping', { n: 2 });
    ee.emit('ping', { n: 3 });

    expect(seen).toEqual([1, 2, 3]);
  });

  test('once fires exactly once then auto-unsubscribes', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];

    ee.once('ping', (data) => seen.push(data.n));
    ee.emit('ping', { n: 1 });
    ee.emit('ping', { n: 2 });
    ee.emit('ping', { n: 3 });

    expect(seen).toEqual([1]);
  });

  test('the unsubscribe fn returned by on stops further delivery', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];

    const off = ee.on('ping', (data) => seen.push(data.n));
    ee.emit('ping', { n: 1 });
    off();
    ee.emit('ping', { n: 2 });

    expect(seen).toEqual([1]);
  });

  test('calling the unsubscribe fn twice is a no-op (idempotent)', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];

    const off = ee.on('ping', (data) => seen.push(data.n));
    off();
    expect(() => off()).not.toThrow();
    ee.emit('ping', { n: 1 });

    expect(seen).toEqual([]);
  });

  test('off removes a specific handler by reference', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const a: number[] = [];
    const b: number[] = [];
    const handlerA = (data: { n: number }) => a.push(data.n);
    const handlerB = (data: { n: number }) => b.push(data.n);

    ee.on('ping', handlerA);
    ee.on('ping', handlerB);
    ee.off('ping', handlerA);
    ee.emit('ping', { n: 1 });

    expect(a).toEqual([]);
    expect(b).toEqual([1]);
  });

  test('off with a never-registered handler is a no-op', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const neverRegistered = (data: { n: number }) => {
      void data;
    };
    expect(() => ee.off('ping', neverRegistered)).not.toThrow();
  });

  test('multiple listeners on the same event each receive it', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];

    ee.on('ping', (data) => a.push(data.n));
    ee.on('ping', (data) => b.push(data.n));
    ee.on('ping', (data) => c.push(data.n));
    ee.emit('ping', { n: 42 });

    expect(a).toEqual([42]);
    expect(b).toEqual([42]);
    expect(c).toEqual([42]);
  });

  test('registering the same handler reference twice subscribes it once (Set dedupe)', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];
    const handler = (data: { n: number }) => seen.push(data.n);

    ee.on('ping', handler);
    ee.on('ping', handler);
    ee.emit('ping', { n: 1 });

    expect(seen).toEqual([1]);
  });

  test('emit with no listeners is a no-op (does not throw)', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    expect(() => ee.emit('ping', { n: 1 })).not.toThrow();
  });

  test('handlers are isolated per event name', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const pings: number[] = [];
    const pongs: string[] = [];

    ee.on('ping', (data) => pings.push(data.n));
    ee.on('pong', (data) => pongs.push(data.label));
    ee.emit('ping', { n: 1 });

    expect(pings).toEqual([1]);
    expect(pongs).toEqual([]);
  });

  test('once returns an unsubscribe fn that cancels before the event fires', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const seen: number[] = [];

    const off = ee.once('ping', (data) => seen.push(data.n));
    off();
    ee.emit('ping', { n: 1 });

    expect(seen).toEqual([]);
  });

  test('removeAllListeners drops every handler across all events', () => {
    const ee = new TypedEventEmitter<TestEventMap>();
    const pings: number[] = [];
    const pongs: string[] = [];

    ee.on('ping', (data) => pings.push(data.n));
    ee.on('pong', (data) => pongs.push(data.label));
    ee.removeAllListeners();
    ee.emit('ping', { n: 1 });
    ee.emit('pong', { label: 'x' });

    expect(pings).toEqual([]);
    expect(pongs).toEqual([]);
  });
});
