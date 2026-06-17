import { Money } from '@agicash/money';
import { describe, expect, test } from 'bun:test';
import { LightningAddressService } from './lightning-address-service';

// Minimal deps: only what each tested path touches. The cast keeps the unused
// repos/wallets out of the test — handleLud16Request only reads userRepository,
// and the range guard returns before touching anything.
function makeService(
  overrides: Partial<{
    getByUsername: (u: string) => Promise<unknown>;
  }> = {},
) {
  const userRepository = {
    getByUsername:
      overrides.getByUsername ??
      (async () => ({ id: 'user-1', username: 'alice' })),
    get: async () => ({ id: 'user-1', username: 'alice' }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  return new LightningAddressService({
    db: {} as any,
    userRepository: userRepository as any,
    defaultAccountRepository: {} as any,
    sparkWallets: {} as any,
    verifyEncryptionKey: new Uint8Array(32),
  });
}

describe('LightningAddressService.handleLud16Request', () => {
  test('returns LUD-16 payRequest params with msat bounds', async () => {
    const service = makeService();
    const res = await service.handleLud16Request({
      username: 'alice',
      baseUrl: 'https://agi.cash',
    });
    expect(res).toEqual({
      tag: 'payRequest',
      callback: 'https://agi.cash/api/lnurlp/callback/user-1',
      minSendable: 1000, // 1 sat = 1000 msat
      maxSendable: 1_000_000_000, // 1,000,000 sat = 1e9 msat
      metadata: JSON.stringify([
        ['text/plain', 'Pay to alice@agi.cash'],
        ['text/identifier', 'alice@agi.cash'],
      ]),
    });
  });

  test('returns not-found when the username does not resolve', async () => {
    const service = makeService({ getByUsername: async () => null });
    const res = await service.handleLud16Request({
      username: 'ghost',
      baseUrl: 'https://agi.cash',
    });
    expect(res).toEqual({ status: 'ERROR', reason: 'not found' });
  });
});

describe('LightningAddressService.handleLnurlpCallback range guard', () => {
  test('rejects amounts below the minimum', async () => {
    const service = makeService();
    const res = await service.handleLnurlpCallback({
      userId: 'user-1',
      amount: new Money({ amount: 0, currency: 'BTC', unit: 'msat' }),
      baseUrl: 'https://agi.cash',
    });
    expect(res).toMatchObject({ status: 'ERROR' });
    expect((res as { reason: string }).reason).toContain('Amount out of range');
  });

  test('rejects amounts above the maximum', async () => {
    const service = makeService();
    const res = await service.handleLnurlpCallback({
      userId: 'user-1',
      amount: new Money({ amount: 2_000_000, currency: 'BTC', unit: 'sat' }),
      baseUrl: 'https://agi.cash',
    });
    expect(res).toMatchObject({ status: 'ERROR' });
    expect((res as { reason: string }).reason).toContain('Amount out of range');
  });
});
