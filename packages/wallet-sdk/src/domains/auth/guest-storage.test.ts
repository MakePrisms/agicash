import { describe, expect, it } from 'bun:test';
import { inMemoryStorage } from '../../internal/test-support';
import { GuestCredentialStore } from './guest-storage';

describe('GuestCredentialStore', () => {
  it('round-trips stored credentials', async () => {
    const store = new GuestCredentialStore(inMemoryStorage());
    await store.store({ id: 'g1', password: 'pw' });
    expect(await store.get()).toEqual({ id: 'g1', password: 'pw' });
  });

  it('returns null when nothing is stored', async () => {
    const store = new GuestCredentialStore(inMemoryStorage());
    expect(await store.get()).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const store = new GuestCredentialStore(
      inMemoryStorage({ guestAccount: 'not json' }),
    );
    expect(await store.get()).toBeNull();
  });

  it('clear() removes the stored credentials', async () => {
    const storage = inMemoryStorage();
    const store = new GuestCredentialStore(storage);
    await store.store({ id: 'g1', password: 'pw' });
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
