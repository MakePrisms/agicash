import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { ServerAccountRepository } from './server-account-repository';

const cashuWallets = {
  getInitialized: async () => ({
    wallet: { id: 'cashu-wallet' },
    isOnline: true,
  }),
} as never;
const sparkWallets = {
  getInitialized: async () => ({
    wallet: { id: 'spark-wallet' },
    balance: null,
    isOnline: true,
  }),
} as never;

const userRow = (overrides: Record<string, unknown> = {}) => ({
  default_btc_account_id: 'acc-btc',
  default_usd_account_id: 'acc-usd',
  default_currency: 'BTC',
  accounts: [
    {
      id: 'acc-btc',
      name: 'Bitcoin',
      type: 'cashu',
      currency: 'BTC',
      purpose: 'transactional',
      state: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      version: 1,
      expires_at: null,
      details: {
        mint_url: 'https://mint.test',
        is_test_mint: false,
        keyset_counters: {},
      },
    },
  ],
  ...overrides,
});

describe('ServerAccountRepository.getDefaultAccount', () => {
  it('returns a redacted cashu account (no proofs) built with a seedless wallet', async () => {
    const db = makeFakeDb({ selectResult: { data: userRow(), error: null } });
    const repo = new ServerAccountRepository(db, cashuWallets, sparkWallets);
    const account = await repo.getDefaultAccount('user-1', 'BTC');
    expect(account).toMatchObject({
      id: 'acc-btc',
      type: 'cashu',
      mintUrl: 'https://mint.test',
      isOnline: true,
    });
    expect('proofs' in account).toBe(false);
  });

  it('throws NotFoundError when no default account exists for the currency', async () => {
    const db = makeFakeDb({
      selectResult: {
        data: userRow({ default_btc_account_id: null, accounts: [] }),
        error: null,
      },
    });
    const repo = new ServerAccountRepository(db, cashuWallets, sparkWallets);
    await expect(repo.getDefaultAccount('user-1', 'BTC')).rejects.toMatchObject(
      { code: 'account_not_found' },
    );
  });
});
