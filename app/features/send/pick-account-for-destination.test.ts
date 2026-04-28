import { describe, expect, test } from 'bun:test';
import type { Account, CashuAccount } from '~/features/accounts/account';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { pickAccountForDestination } from './pick-account-for-destination';

const MINT_URL = 'https://mint.minibits.cash/Bitcoin';
const MAP = { Minibits: MINT_URL };

const buildBolt11 = (overrides: Partial<DecodedBolt11>): DecodedBolt11 => ({
  amountMsat: 1_000_000,
  amountSat: 1000,
  createdAtUnixMs: 1_700_000_000_000,
  expiryUnixMs: 1_700_000_003_600_000,
  network: 'bitcoin',
  description: undefined,
  paymentHash: 'deadbeef',
  ...overrides,
});

const buildCashuAccount = (
  mintUrl: string,
  currency: 'BTC' | 'USD',
  balance: number,
): CashuAccount =>
  ({
    id: `cashu-${mintUrl}-${currency}`,
    name: `test-${currency}`,
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency,
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl,
    isTestMint: false,
    keysetCounters: {},
    proofs: balance > 0 ? [{ amount: balance }] : [],
    wallet: {} as never,
  }) as unknown as CashuAccount;

const DEFAULT_ACCOUNT: Account = {
  id: 'default-account',
  name: 'default',
  type: 'spark',
} as unknown as Account;

describe('pickAccountForDestination', () => {
  test('returns default when description is missing', () => {
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({ description: undefined }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 5000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default when description is set but unmapped', () => {
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({ description: 'Some other mint' }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 5000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default when description maps to a mint user has no account at', () => {
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({ description: 'Minibits' }),
      accounts: [
        buildCashuAccount('https://mint.other.example/Bitcoin', 'BTC', 5000),
      ],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default for zero-amount invoice (amountSat undefined)', () => {
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: undefined,
        amountMsat: undefined,
      }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 5000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns BTC account when balance covers invoice', () => {
    const matched = buildCashuAccount(MINT_URL, 'BTC', 5000);
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 1000,
      }),
      accounts: [matched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(matched);
  });

  test('ignores non-cashu accounts in the input list', () => {
    const matched = buildCashuAccount(MINT_URL, 'BTC', 5000);
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 1000,
      }),
      accounts: [DEFAULT_ACCOUNT, matched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(matched);
  });

  test('returns BTC account when balance exactly equals invoice', () => {
    const matched = buildCashuAccount(MINT_URL, 'BTC', 1000);
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 1000,
      }),
      accounts: [matched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(matched);
  });

  test('returns default when only candidate is BTC and balance is below invoice', () => {
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 5000,
      }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 1000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('skips USD candidates at the matched mint (USD support deferred)', () => {
    const usdAccount = buildCashuAccount(MINT_URL, 'USD', 1_000_000);
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 1000,
      }),
      accounts: [usdAccount],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('picks first BTC candidate that covers when multiple are present', () => {
    const btcShort = buildCashuAccount(MINT_URL, 'BTC', 100);
    const btcCovers = buildCashuAccount(MINT_URL, 'BTC', 5000);
    const result = pickAccountForDestination({
      decodedDestination: buildBolt11({
        description: 'Minibits',
        amountSat: 1000,
      }),
      accounts: [btcShort, btcCovers],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(btcCovers);
  });
});
