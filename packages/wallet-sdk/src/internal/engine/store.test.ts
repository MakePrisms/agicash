import { describe, expect, it } from 'bun:test';
import { createEngineQueryClient } from './query-client';
import { createStore } from './store';

describe('createStore', () => {
  it('get() is undefined before load, the value after toPromise()', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k1'], async () => [1, 2, 3]);
    expect(store.get()).toBeUndefined();
    const loaded = await store.toPromise();
    expect(loaded).toEqual([1, 2, 3]);
    expect(store.get()).toEqual([1, 2, 3]);
  });

  it('set() writes synchronously and get() reflects it immediately', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k2'], async () => [1]);
    await store.toPromise();
    store.set((prev = []) => [...prev, 9]);
    expect(store.get()).toEqual([1, 9]); // synchronous
  });

  it('subscribe() fires on set() and the unsubscribe stops it', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k3'], async () => [1]);
    await store.toPromise();
    let hits = 0;
    const off = store.subscribe(() => {
      hits += 1;
    });
    store.set(() => [2]);
    expect(hits).toBeGreaterThanOrEqual(1);
    const at = hits;
    off();
    store.set(() => [3]);
    expect(hits).toBe(at); // no more notifications after unsubscribe
  });

  it('get() is referentially stable when content is unchanged (useSyncExternalStore safety)', async () => {
    const client = createEngineQueryClient();
    const store = createStore<{ a: number }>(client, ['k4'], async () => ({
      a: 1,
    }));
    await store.toPromise();
    const first = store.get();
    store.set(() => ({ a: 1 })); // same content
    expect(store.get()).toBe(first); // structural sharing preserves identity
  });
});
