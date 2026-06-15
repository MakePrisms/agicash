import { describe, expect, test } from 'bun:test';
import { inMemoryStorageAdapter } from '../../storage/memory';
import { createOpenSecretStorage } from './opensecret-storage';

describe('createOpenSecretStorage', () => {
  test('persistent maps to the host adapter (undefined -> null)', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);
    expect(await storage.persistent.getItem('access_token')).toBeNull();
    await storage.persistent.setItem('access_token', 'abc');
    expect(await storage.persistent.getItem('access_token')).toBe('abc');
    expect(await adapter.get('access_token')).toBe('abc');
    await storage.persistent.removeItem('access_token');
    expect(await storage.persistent.getItem('access_token')).toBeNull();
  });

  test('session is in-memory and never touches the host adapter (no session adapter)', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);
    await storage.session.setItem('sessionKey', 'k');
    expect(storage.session.getItem('sessionKey')).toBe('k');
    expect(await adapter.get('sessionKey')).toBeUndefined();
  });

  test('a host session adapter (web sessionStorage) backs the session scope', async () => {
    const persistent = inMemoryStorageAdapter();
    const sessionAdapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(persistent, sessionAdapter);
    await storage.session.setItem('sessionKey', 'k');
    expect(await sessionAdapter.get('sessionKey')).toBe('k');
    expect(await persistent.get('sessionKey')).toBeUndefined();
    await storage.clearSession();
    expect(await sessionAdapter.get('sessionKey')).toBeUndefined();
  });

  test('clearSession() drops in-memory session material', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);
    await storage.session.setItem('sessionId', 'x');
    await storage.clearSession();
    expect(storage.session.getItem('sessionId')).toBeNull();
  });
});
