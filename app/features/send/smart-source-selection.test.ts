import { describe, expect, test } from 'bun:test';
import type { Account, CashuAccount } from '~/features/accounts/account';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { selectSourceAccountForBolt11 } from './smart-source-selection';

const MINT_URL = 'https://mint.minibits.cash/Bitcoin';
const MAP = { Minibits: MINT_URL };

const buildBolt11 = (overrides: Partial<DecodedBolt11>): DecodedBolt11 => ({
  amountMsat: 1_000_000,
  amountSat: 1000,
  expiryUnixMs: undefined,
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

describe('selectSourceAccountForBolt11', () => {
  test('returns default when description is missing', () => {
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: undefined }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 5000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default when description is set but unmapped', () => {
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Some other mint' }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 5000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default when description maps to a mint user has no account at', () => {
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits' }),
      accounts: [
        buildCashuAccount('https://mint.other.example/Bitcoin', 'BTC', 5000),
      ],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default for zero-amount invoice (amountSat undefined)', () => {
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({
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
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 1000 }),
      accounts: [matched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(matched);
  });

  test('returns BTC account when balance exactly equals invoice', () => {
    const matched = buildCashuAccount(MINT_URL, 'BTC', 1000);
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 1000 }),
      accounts: [matched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(matched);
  });

  test('returns default when only candidate is BTC and balance is below invoice', () => {
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 5000 }),
      accounts: [buildCashuAccount(MINT_URL, 'BTC', 1000)],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns USD account when BTC candidate is short and USD balance covers (using rate)', () => {
    const btcShort = buildCashuAccount(MINT_URL, 'BTC', 100);
    // 5000 sats at 100k USD/BTC = $5 = 500 cents. USD account has 1000 cents.
    const usdMatched = buildCashuAccount(MINT_URL, 'USD', 1000);
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 5000 }),
      accounts: [btcShort, usdMatched],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
      btcToUsdRate: 100_000,
    });
    expect(result).toBe(usdMatched);
  });

  test('skips USD candidates when no rate provided', () => {
    const usdAccount = buildCashuAccount(MINT_URL, 'USD', 1_000_000);
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 1000 }),
      accounts: [usdAccount],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
      // btcToUsdRate intentionally omitted
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('returns default when neither BTC nor USD candidate has enough balance', () => {
    const btcShort = buildCashuAccount(MINT_URL, 'BTC', 100);
    const usdShort = buildCashuAccount(MINT_URL, 'USD', 10);
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 5000 }),
      accounts: [btcShort, usdShort],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
      btcToUsdRate: 100_000,
    });
    expect(result).toBe(DEFAULT_ACCOUNT);
  });

  test('iterates candidates in given order — first that covers wins', () => {
    const usdMatched = buildCashuAccount(MINT_URL, 'USD', 1_000_000);
    const btcAlsoMatches = buildCashuAccount(MINT_URL, 'BTC', 5000);
    // USD comes first in the list — it should win even though BTC also covers
    const result = selectSourceAccountForBolt11({
      decoded: buildBolt11({ description: 'Minibits', amountSat: 1000 }),
      accounts: [usdMatched, btcAlsoMatches],
      defaultAccount: DEFAULT_ACCOUNT,
      mintDescriptionMap: MAP,
      btcToUsdRate: 100_000,
    });
    expect(result).toBe(usdMatched);
  });
});
