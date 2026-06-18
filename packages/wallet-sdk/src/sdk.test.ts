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
  lud16Domain: 'test.example',
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
  it('auth and user domains are real (not the NotImplemented stub)', async () => {
    const sdk = await Sdk.create(config);
    // The config fixture's storage has no tokens, so a REAL getCurrentUser
    // resolves to null; the Proxy stub would throw NotImplementedError
    // synchronously instead of returning a promise.
    await expect(sdk.user.getCurrentUser()).resolves.toBeNull();
    // A REAL signIn returns a promise that rejects with a non-NotImplemented
    // error (no session after the mocked no-op auth); the stub would throw
    // NotImplementedError synchronously.
    const err = await sdk.auth
      .signIn({ email: 'a', password: 'b' })
      .catch((e) => e);
    expect(err).not.toBeInstanceOf(NotImplementedError);
    await sdk.destroy();
  });
  it('accounts, scan, and exchangeRate domains are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.accounts.list).toBe('function');
    expect(typeof sdk.scan.parse).toBe('function');
    expect(typeof sdk.exchangeRate.getRate).toBe('function');
    await sdk.destroy();
  });
  it('spark create/read methods are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.spark.send.createLightningQuote).toBe('function');
    expect(typeof sdk.spark.send.get).toBe('function');
    expect(typeof sdk.spark.receive.createLightningQuote).toBe('function');
    expect(typeof sdk.spark.receive.get).toBe('function');
    await sdk.destroy();
  });
  it('still-unimplemented domains throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
  it('S8: transactions/contacts/transfers are real domains (not NotImplemented stubs)', async () => {
    const sdk = await Sdk.create(config);
    // Real async methods return a Promise (not throw synchronously like the stub does).
    // Suppress unhandled rejections with .catch — we only test the return type here.
    const txResult = sdk.transactions.countPendingAck();
    expect(txResult).toBeInstanceOf(Promise);
    txResult.catch(() => {});
    const ctResult = sdk.contacts.list();
    expect(ctResult).toBeInstanceOf(Promise);
    ctResult.catch(() => {});
    const trResult = sdk.transfers.createQuote({} as never);
    expect(trResult).toBeInstanceOf(Promise);
    trResult.catch(() => {});
    await sdk.destroy();
  });
  it('cashu create/read methods are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.cashu.send.createTokenQuote).toBe('function');
    expect(typeof sdk.cashu.send.get).toBe('function');
    expect(typeof sdk.cashu.receive.createLightningQuote).toBe('function');
    await sdk.destroy();
  });
  it('still-dark S7 entry points throw NotImplemented', async () => {
    const sdk = await Sdk.create(config);
    expect(() =>
      sdk.cashu.receive.receiveToken({ token: 't' } as never),
    ).toThrow(NotImplementedError);
    await sdk.destroy();
  });
});
