import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';

const createMemoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

// Shaped like the enclave's state: base64url JSON, here with padding and symbols.
const state = 'eyJjc3JmX3Rva2VuIjoiYWJjIiwiY2xpZW50X2lkIjoiMTIzIn0=';

describe('oauthLoginSessionStorage', () => {
  beforeEach(() => {
    globalThis.sessionStorage = createMemoryStorage();
  });

  afterEach(() => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = undefined;
  });

  it('stores the login location under a hash of the OAuth state', () => {
    const session = oauthLoginSessionStorage.create(state, {
      search: '?redirectTo=%2Fsend',
      hash: '#token',
    });

    expect(session).toMatchObject({
      search: '?redirectTo=%2Fsend',
      hash: '#token',
    });
    expect(sessionStorage.key(0)).toMatch(/^oauthLoginSession__[0-9a-f]{64}$/);
    expect(oauthLoginSessionStorage.get(state)).toEqual(session);
    expect(oauthLoginSessionStorage.get(state.slice(0, -1))).toBeNull();
  });

  it('removes the session by state', () => {
    oauthLoginSessionStorage.create(state, { search: '', hash: '' });

    oauthLoginSessionStorage.remove(state);

    expect(oauthLoginSessionStorage.get(state)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
