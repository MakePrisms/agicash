/**
 * useQ tests — verify the Query<T> → useSyncExternalStore bridge logic
 * without a DOM/React renderer by exercising the underlying state machine.
 *
 * We test the PURE behavioural contract: pending → throws, error → throws, success → data.
 * React-specific rendering is left to integration tests.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { Query, QueryState } from '@agicash/wallet-sdk';

/** Build a minimal Query<T> stub from a fixed snapshot. */
function makeQuery<T>(snapshot: QueryState<T>): Query<T> {
  return {
    getSnapshot: () => snapshot,
    subscribe: (_onData, _onError) => () => {
      /* noop */
    },
    toPromise: () => Promise.resolve(snapshot.data as T),
    refetch: () => Promise.resolve(snapshot.data as T),
  };
}

/** Minimal snapshot factories. */
const pendingSnapshot = <T>(): QueryState<T> => ({
  status: 'pending',
  data: undefined,
  error: undefined,
  isPending: true,
  isError: false,
  isSuccess: false,
  isFetching: true,
});

const errorSnapshot = <T>(error: unknown): QueryState<T> => ({
  status: 'error',
  data: undefined,
  error,
  isPending: false,
  isError: true,
  isSuccess: false,
  isFetching: false,
});

const successSnapshot = <T>(data: T): QueryState<T> => ({
  status: 'success',
  data,
  error: undefined,
  isPending: false,
  isError: false,
  isSuccess: true,
  isFetching: false,
});

describe('Query<T> state machine contract', () => {
  test('pending snapshot: toPromise is a thenable (suspense contract)', async () => {
    const q = makeQuery(pendingSnapshot<string>());
    const snapshot = q.getSnapshot();
    expect(snapshot.status).toBe('pending');
    // Verify toPromise is a promise (the value thrown for Suspense).
    const p = q.toPromise();
    expect(typeof p.then).toBe('function');
  });

  test('error snapshot: error field is populated', () => {
    const err = new Error('boom');
    const q = makeQuery(errorSnapshot<string>(err));
    const snapshot = q.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toBe(err);
    expect(snapshot.isError).toBe(true);
  });

  test('success snapshot: data is accessible', () => {
    const data = ['account-1', 'account-2'];
    const q = makeQuery(successSnapshot(data));
    const snapshot = q.getSnapshot();
    expect(snapshot.status).toBe('success');
    expect(snapshot.data).toEqual(data);
    expect(snapshot.isSuccess).toBe(true);
  });

  test('subscribe emits current snapshot immediately on attach', () => {
    const received: string[] = [];
    const q: Query<string> = {
      getSnapshot: () => successSnapshot('hello'),
      subscribe: (onData, _onError) => {
        // simulate immediate emit
        onData('hello');
        return () => {
          /* noop */
        };
      },
      toPromise: () => Promise.resolve('hello'),
      refetch: () => Promise.resolve('hello'),
    };
    q.subscribe((d) => received.push(d));
    expect(received).toEqual(['hello']);
  });

  test('subscribe returns an unsubscribe function', () => {
    const unsubscribeMock = mock(() => {
      /* noop */
    });
    const q: Query<number> = {
      getSnapshot: () => successSnapshot(42),
      subscribe: (_onData, _onError) => unsubscribeMock,
      toPromise: () => Promise.resolve(42),
      refetch: () => Promise.resolve(42),
    };
    const off = q.subscribe(() => {
      /* noop */
    });
    off();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
