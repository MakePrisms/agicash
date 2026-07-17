import { describe, expect, it } from 'bun:test';
import type { AuthKeyValueStore } from '../domain/sdk';
import { createGuestAccountStorage } from './guest-account-storage';
import { nullLogger } from './logger';

const createMemoryStore = (): AuthKeyValueStore & {
  data: Map<string, string>;
} => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

describe('guestAccountStorage', () => {
  it('round-trips guest account details under the legacy key', async () => {
    const store = createMemoryStore();
    const storage = createGuestAccountStorage(store, nullLogger);

    await storage.store({ id: 'guest-1', password: 'pw' });

    expect(store.data.has('guestAccount')).toBe(true);
    expect(await storage.get()).toEqual({ id: 'guest-1', password: 'pw' });
  });

  it('returns null when nothing is stored', async () => {
    const storage = createGuestAccountStorage(createMemoryStore(), nullLogger);
    expect(await storage.get()).toBeNull();
  });

  it('returns null for corrupt or invalid data', async () => {
    const store = createMemoryStore();
    store.data.set('guestAccount', 'not-json');
    const storage = createGuestAccountStorage(store, nullLogger);
    expect(await storage.get()).toBeNull();

    store.data.set('guestAccount', JSON.stringify({ id: 42 }));
    expect(await storage.get()).toBeNull();
  });

  it('clear removes the stored account', async () => {
    const store = createMemoryStore();
    const storage = createGuestAccountStorage(store, nullLogger);
    await storage.store({ id: 'guest-1', password: 'pw' });

    await storage.clear();

    expect(await storage.get()).toBeNull();
  });
});
