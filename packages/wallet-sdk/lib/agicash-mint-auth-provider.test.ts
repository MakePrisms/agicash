import { beforeEach, describe, expect, mock, test } from 'bun:test';

const generateThirdPartyToken =
  mock<(name: string) => Promise<{ token: string }>>();

mock.module('@agicash/opensecret', () => ({ generateThirdPartyToken }));

import {
  clearAgicashMintAuthToken,
  getAgicashMintAuthProvider,
} from './agicash-mint-auth-provider';

function makeToken(id: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tokenA = makeToken('user-a');
const tokenB = makeToken('user-b');

// AuthProvider.ensureCAT is optional in cashu-ts; our provider always sets it.
function getEnsureCAT() {
  const ensureCAT = getAgicashMintAuthProvider().ensureCAT;
  if (!ensureCAT) throw new Error('provider must implement ensureCAT');
  return ensureCAT;
}

describe('agicash mint auth provider', () => {
  beforeEach(() => {
    clearAgicashMintAuthToken();
    generateThirdPartyToken.mockReset();
  });

  test('reuses the cached CAT until refresh time', async () => {
    generateThirdPartyToken.mockResolvedValueOnce({ token: tokenA });
    const ensureCAT = getEnsureCAT();

    expect(await ensureCAT()).toBe(tokenA);
    expect(await ensureCAT()).toBe(tokenA);
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(1);
  });

  test('clear during an in-flight fetch discards its cache write', async () => {
    const fetchA = deferred<{ token: string }>();
    generateThirdPartyToken.mockReturnValueOnce(fetchA.promise);
    const ensureCAT = getEnsureCAT();

    const before = ensureCAT();
    clearAgicashMintAuthToken();
    fetchA.resolve({ token: tokenA });
    await before;

    generateThirdPartyToken.mockResolvedValueOnce({ token: tokenB });
    expect(await ensureCAT()).toBe(tokenB);
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });

  test('fetch started before clear cannot clobber the one started after', async () => {
    const fetchA = deferred<{ token: string }>();
    const fetchB = deferred<{ token: string }>();
    generateThirdPartyToken
      .mockReturnValueOnce(fetchA.promise)
      .mockReturnValueOnce(fetchB.promise);
    const ensureCAT = getEnsureCAT();

    const before = ensureCAT();
    clearAgicashMintAuthToken();
    const after = ensureCAT();

    fetchA.resolve({ token: tokenA });
    await before;

    // The pre-clear fetch settling must not evict the newer in-flight fetch.
    const deduped = ensureCAT();
    fetchB.resolve({ token: tokenB });
    expect(await after).toBe(tokenB);
    expect(await deduped).toBe(tokenB);
    expect(await ensureCAT()).toBe(tokenB);
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });
});
