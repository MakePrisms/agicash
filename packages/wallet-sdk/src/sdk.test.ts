import { describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from './config';
import { NotImplementedError, Sdk } from './index';

mock.module('@agicash/opensecret', () => ({
  configure: () => {},
  generateThirdPartyToken: async () => ({ token: 'tok' }),
  getPrivateKey: async () => ({ mnemonic: 'm' }),
  getPrivateKeyBytes: async () => ({ private_key: '00'.repeat(32) }),
  getPublicKey: async () => ({ public_key: '02'.padEnd(66, '0') }),
}));

mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    realtime: {},
    removeAllChannels: async () => [],
  }),
}));

function makeMem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}
const config = {
  openSecret: { url: 'https://os.test', clientId: 'c' },
  supabase: { url: 'https://sb.test', anonKey: 'anon' },
  storage: { persistent: makeMem(), session: makeMem() },
} as unknown as SdkConfig;

describe('Sdk core shell', () => {
  it('create() returns an Sdk and destroy() resolves', async () => {
    const sdk = await Sdk.create(config);
    expect(sdk).toBeInstanceOf(Sdk);
    await sdk.destroy();
  });
  it('every stubbed domain throws NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.auth.signIn({ email: 'a', password: 'b' })).toThrow(
      NotImplementedError,
    );
    expect(() => sdk.user.getCurrentUser()).toThrow(NotImplementedError);
    expect(() => sdk.accounts.list()).toThrow(NotImplementedError);
    expect(() => sdk.cashu.send.failQuote({} as never, 'x')).toThrow(
      NotImplementedError,
    );
    expect(() => sdk.spark.receive.get('id')).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
  });
});
