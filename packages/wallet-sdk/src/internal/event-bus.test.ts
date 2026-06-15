import { describe, expect, mock, test } from 'bun:test';
import { EventBus } from './event-bus';

type TestMap = { ping: { n: number }; pong: Record<string, never> };

describe('EventBus', () => {
  test('emit delivers payload to subscribers of that event only', () => {
    const bus = new EventBus<TestMap>();
    const onPing = mock(() => {});
    const onPong = mock(() => {});
    bus.on('ping', onPing);
    bus.on('pong', onPong);
    bus.emit('ping', { n: 7 });
    expect(onPing).toHaveBeenCalledTimes(1);
    expect((onPing.mock.calls[0] as unknown[])[0]).toEqual({ n: 7 });
    expect(onPong).not.toHaveBeenCalled();
  });

  test('unsubscribe stops delivery', () => {
    const bus = new EventBus<TestMap>();
    const cb = mock(() => {});
    const off = bus.on('ping', cb);
    off();
    bus.emit('ping', { n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  test('a throwing listener does not block others', () => {
    const bus = new EventBus<TestMap>();
    const good = mock(() => {});
    bus.on('ping', () => {
      throw new Error('listener boom');
    });
    bus.on('ping', good);
    expect(() => bus.emit('ping', { n: 1 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('clear() removes all listeners', () => {
    const bus = new EventBus<TestMap>();
    const cb = mock(() => {});
    bus.on('ping', cb);
    bus.clear();
    bus.emit('ping', { n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});
