import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from './config';
import { NotImplementedError, Sdk } from './index';
import { breezModuleMock, openSecretModuleMock } from './internal/test-support';

mock.module('@agicash/opensecret', () => openSecretModuleMock());

mock.module('@agicash/breez-sdk-spark', () => breezModuleMock());

mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    realtime: {},
    removeAllChannels: async () => [],
  }),
}));

// bun's mock.module is process-global; restore after this file so these mocks
// stay isolated from other files mocking the same modules.
afterAll(() => mock.restore());

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
  defaultAccounts: [
    {
      type: 'spark',
      currency: 'BTC',
      name: 'Bitcoin',
      network: 'MAINNET',
      purpose: 'transactional',
      isDefault: true,
    },
  ],
} as unknown as SdkConfig;

describe('Sdk core shell', () => {
  it('create() returns an Sdk and destroy() resolves', async () => {
    const sdk = await Sdk.create(config);
    expect(sdk).toBeInstanceOf(Sdk);
    await sdk.destroy();
  });
  it('auth and user domains are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.auth.signIn).toBe('function');
    expect(typeof sdk.user.getCurrentUser).toBe('function');
    await sdk.destroy();
  });
  it('unimplemented domains still throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.accounts.list()).toThrow(NotImplementedError);
    expect(() => sdk.cashu.send.failQuote({} as never, 'x')).toThrow(
      NotImplementedError,
    );
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
});
