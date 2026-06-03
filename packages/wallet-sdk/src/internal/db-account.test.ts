import { describe, expect, test } from 'bun:test';
import {
  type AccountHandleResolver,
  DeferredAccountHandleResolver,
} from './account-handle-resolver';
import {
  type AgicashDbAccount,
  type AgicashDbAccountWithProofs,
  dbAccountToAccount,
  isCashuAccount,
  isSparkAccount,
} from './db-account';

const deferred = new DeferredAccountHandleResolver();

const cashuBase: AgicashDbAccount = {
  id: 'a1',
  name: 'Mint',
  type: 'cashu',
  purpose: 'transactional',
  state: 'active',
  currency: 'BTC',
  details: {
    mint_url: 'https://mint.example.com',
    is_test_mint: true,
    keyset_counters: {},
  },
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
  user_id: 'u1',
  version: 1,
};

describe('type guards', () => {
  test('isCashuAccount true for a valid cashu row', () => {
    expect(isCashuAccount(cashuBase)).toBe(true);
  });

  test('isCashuAccount false for a spark row', () => {
    const spark: AgicashDbAccount = {
      ...cashuBase,
      type: 'spark',
      details: { network: 'REGTEST' },
    };
    expect(isCashuAccount(spark)).toBe(false);
    expect(isSparkAccount(spark)).toBe(true);
  });

  test('isCashuAccount throws when type=cashu but details are invalid', () => {
    const bad: AgicashDbAccount = { ...cashuBase, details: { mint_url: 123 } };
    expect(() => isCashuAccount(bad)).toThrow();
  });
});

describe('dbAccountToAccount (deferred resolver)', () => {
  test('maps a cashu row, deferring wallet/proofs/isOnline', async () => {
    const row: AgicashDbAccountWithProofs = { ...cashuBase, cashu_proofs: [] };
    const account = await dbAccountToAccount(row, deferred);

    expect(account.id).toBe('a1');
    expect(account.type).toBe('cashu');
    expect(account.currency).toBe('BTC');
    expect(account.version).toBe(1);
    if (account.type === 'cashu') {
      expect(account.mintUrl).toBe('https://mint.example.com');
      expect(account.isTestMint).toBe(true);
      expect(account.proofs).toEqual([]);
      expect(account.isOnline).toBe(false);
    }
  });

  test('maps a spark row, deferring wallet/balance/isOnline', async () => {
    const row: AgicashDbAccountWithProofs = {
      ...cashuBase,
      type: 'spark',
      details: { network: 'MAINNET' },
      cashu_proofs: [],
    };
    const account = await dbAccountToAccount(row, deferred);

    expect(account.type).toBe('spark');
    if (account.type === 'spark') {
      expect(account.network).toBe('MAINNET');
      expect(account.balance).toBeNull();
      expect(account.isOnline).toBe(false);
    }
  });

  test('throws on an unknown account type', async () => {
    const row = {
      ...cashuBase,
      type: 'unknown',
      cashu_proofs: [],
    } as unknown as AgicashDbAccountWithProofs;
    await expect(dbAccountToAccount(row, deferred)).rejects.toThrow(
      'Invalid account type',
    );
  });

  test('uses the injected resolver output (forward-compat with the Slice-3 resolver)', async () => {
    // A fake "Slice 3" resolver that returns a real online cashu wallet handle + proofs.
    const fakeWallet = { getMintInfo: () => ({}) };
    const realResolver: AccountHandleResolver = {
      resolveCashu: async () => ({
        wallet: fakeWallet as never,
        isOnline: true,
        proofs: [],
      }),
      resolveSpark: async () => ({
        wallet: {} as never,
        isOnline: true,
        balance: null,
      }),
    };
    const row: AgicashDbAccountWithProofs = { ...cashuBase, cashu_proofs: [] };
    const account = await dbAccountToAccount(row, realResolver);

    expect(account.isOnline).toBe(true);
    if (account.type === 'cashu') {
      expect(account.wallet).toBe(fakeWallet as never);
    }
  });
});

describe('DeferredAccountHandleResolver — the live handle is a throwing stub', () => {
  test('reading a method off the deferred cashu wallet throws NotImplementedError', async () => {
    const { wallet } = await deferred.resolveCashu({
      mintUrl: 'm',
      currency: 'BTC',
      encryptedProofs: [],
    });
    // The wallet exists as an object, but *using* it (any property access) throws.
    expect(() =>
      (wallet as { getMintInfo: () => unknown }).getMintInfo(),
    ).toThrow('Slice 3');
  });

  test('reading a method off the deferred spark wallet throws NotImplementedError', async () => {
    const { wallet } = await deferred.resolveSpark({ network: 'MAINNET' });
    // `BreezSdk.getInfo` requires an argument (the type is real now); cast via `unknown` to
    // assert the lazy stub throws on any access regardless of the method's real signature.
    expect(() =>
      (wallet as unknown as { getInfo: () => unknown }).getInfo(),
    ).toThrow('Slice 3');
  });
});
