import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from 'bun:test';
import { createThrottle } from './use-throttle';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function setup(delayMs = 1000) {
  const fn = mock(() => undefined);
  const { throttled, cancel } = createThrottle(() => fn, delayMs);
  return { fn, throttled, cancel };
}

describe('createThrottle', () => {
  test('fires immediately on the first call', () => {
    const { fn, throttled } = setup();

    throttled();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('passes arguments through', () => {
    const fn = mock((_a: string, _b: number) => undefined);
    const { throttled } = createThrottle(() => fn, 1000);

    throttled('hello', 42);

    expect(fn).toHaveBeenCalledWith('hello', 42);
  });

  test('suppresses calls within the delay window', () => {
    const { fn, throttled } = setup(100);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('fires trailing call with latest args after delay', () => {
    const fn = mock((_v: string) => undefined);
    const { throttled } = createThrottle(() => fn, 50);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('third');
  });

  test('allows a new call after delay has passed', () => {
    const { fn, throttled } = setup(50);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);

    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('trailing call uses the latest arguments, not earlier ones', () => {
    const fn = mock((_v: number) => undefined);
    const { throttled } = createThrottle(() => fn, 50);

    throttled(1);
    throttled(2);
    throttled(3);
    throttled(4);

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls).toEqual([[1], [4]]);
  });

  test('cancel prevents the trailing call from firing', () => {
    const { fn, throttled, cancel } = setup(50);

    throttled();
    throttled(); // would schedule trailing

    cancel();

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('can be called again after trailing fires and delay passes', () => {
    const { fn, throttled } = setup(50);

    // First burst
    throttled();
    throttled();

    // Wait for trailing + full delay to elapse
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second burst starts fresh
    throttled();
    throttled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test('single call with no follow-ups does not fire a trailing call', () => {
    const { fn, throttled } = setup(50);

    throttled();

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('always calls the latest callback from getCallback', () => {
    const calls: string[] = [];
    let currentFn = () => calls.push('old');
    const { throttled } = createThrottle(() => currentFn, 50);

    throttled();
    expect(calls).toEqual(['old']);

    currentFn = () => calls.push('new');
    throttled(); // schedules trailing

    jest.advanceTimersByTime(50);

    expect(calls).toEqual(['old', 'new']);
  });
});

describe('createThrottle with trailing: false', () => {
  test('fires immediately on the first call', () => {
    const fn = mock(() => undefined);
    const { throttled } = createThrottle(() => fn, 50, { trailing: false });

    throttled();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('suppresses all calls within the delay window', () => {
    const fn = mock(() => undefined);
    const { throttled } = createThrottle(() => fn, 50, { trailing: false });

    throttled();
    throttled();
    throttled();

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('allows a new call after delay has passed', () => {
    const fn = mock(() => undefined);
    const { throttled } = createThrottle(() => fn, 50, { trailing: false });

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);

    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('createThrottle with leading: false', () => {
  test('does not fire immediately on the first call', () => {
    const fn = mock(() => undefined);
    const { throttled } = createThrottle(() => fn, 50, { leading: false });

    throttled();

    expect(fn).toHaveBeenCalledTimes(0);
  });

  test('fires after the delay expires', () => {
    const fn = mock((_v: string) => undefined);
    const { throttled } = createThrottle(() => fn, 50, { leading: false });

    throttled('hello');

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('hello');
  });

  test('uses the latest arguments for the trailing call', () => {
    const fn = mock((_v: number) => undefined);
    const { throttled } = createThrottle(() => fn, 50, { leading: false });

    throttled(1);
    throttled(2);
    throttled(3);

    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  test('allows a new trailing call after delay has passed', () => {
    const fn = mock(() => undefined);
    const { throttled } = createThrottle(() => fn, 50, { leading: false });

    throttled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);

    throttled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
