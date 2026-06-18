import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from '../../config';

const configureCalls: unknown[] = [];
mock.module('@agicash/opensecret', () => ({
  configure: (opts: unknown) => {
    configureCalls.push(opts);
  },
  generateThirdPartyToken: async () => 'token',
  isLoggedIn: () => true,
  getPrivateKey: async () => ({ mnemonic: 'test mnemonic' }),
  getPrivateKeyBytes: async () => ({
    private_key: '00'.repeat(32),
  }),
  getPublicKey: async () => ({
    public_key: `02${'00'.repeat(32)}`,
    algorithm: 'ecdsa',
  }),
}));

const { configureOpenSecret, isLoggedIn } = await import('./open-secret');

// bun's mock.module is process-global; restore after this file so its
// @agicash/opensecret mock stays isolated from other files mocking it.
afterAll(() => mock.restore());

function fakeStorage(tokens: Record<string, string>): SdkConfig['storage'] {
  const kv = {
    getItem: (k: string) => tokens[k] ?? null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  return { persistent: kv, session: kv } as unknown as SdkConfig['storage'];
}
function jwtWithExp(expSeconds: number): string {
  return `h.${btoa(JSON.stringify({ exp: expSeconds })).replace(/=/g, '')}.s`;
}
const nowSec = () => Math.floor(Date.now() / 1000);

describe('configureOpenSecret', () => {
  it('maps SdkConfig to the OpenSecret configure() options', () => {
    const storage = {
      persistent: {},
      session: {},
    } as unknown as SdkConfig['storage'];
    const config = {
      openSecret: { url: 'https://os.test', clientId: 'cid' },
      supabase: { url: 'https://sb.test', anonKey: 'anon' },
      storage,
    } as SdkConfig;
    configureOpenSecret(config);
    expect(configureCalls).toHaveLength(1);
    expect(configureCalls[0]).toEqual({
      apiUrl: 'https://os.test',
      clientId: 'cid',
      storage,
    });
  });
});

describe('isLoggedIn', () => {
  it('is true when both tokens exist and the refresh token is unexpired', async () => {
    const storage = fakeStorage({
      access_token: 'a',
      refresh_token: jwtWithExp(nowSec() + 3600),
    });
    expect(await isLoggedIn(storage)).toBe(true);
  });
  it('is false when tokens are missing', async () => {
    expect(await isLoggedIn(fakeStorage({}))).toBe(false);
  });
  it('is false when the refresh token is expired', async () => {
    const storage = fakeStorage({
      access_token: 'a',
      refresh_token: jwtWithExp(nowSec() - 10),
    });
    expect(await isLoggedIn(storage)).toBe(false);
  });
});
