import { describe, expect, it } from 'bun:test';
import { SdkEventEmitter } from './event-emitter';

type M = { ping: { n: number }; pong: Record<string, never> };

describe('SdkEventEmitter', () => {
  it('delivers emitted payloads to on() handlers', () => {
    const e = new SdkEventEmitter<M>();
    const seen: number[] = [];
    e.on('ping', (d) => seen.push(d.n));
    e.emit('ping', { n: 1 });
    e.emit('ping', { n: 2 });
    expect(seen).toEqual([1, 2]);
  });
  it('unsubscribe stops delivery', () => {
    const e = new SdkEventEmitter<M>();
    const seen: number[] = [];
    const off = e.on('ping', (d) => seen.push(d.n));
    e.emit('ping', { n: 1 });
    off();
    e.emit('ping', { n: 2 });
    expect(seen).toEqual([1]);
  });
  it('once() fires exactly once then auto-unsubscribes', () => {
    const e = new SdkEventEmitter<M>();
    let count = 0;
    e.once('ping', () => count++);
    e.emit('ping', { n: 1 });
    e.emit('ping', { n: 2 });
    expect(count).toBe(1);
  });
  it('emit with no handlers is a no-op; unsubscribe during emit is safe', () => {
    const e = new SdkEventEmitter<M>();
    expect(() => e.emit('pong', {})).not.toThrow();
    const seen: number[] = [];
    const off = e.on('ping', (d) => {
      seen.push(d.n);
      off();
    });
    e.on('ping', (d) => seen.push(d.n * 10));
    e.emit('ping', { n: 1 });
    expect(seen).toEqual([1, 10]);
  });
});
