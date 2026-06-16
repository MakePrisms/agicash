import { describe, expect, it } from 'bun:test';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from './account-details';

describe('account-details', () => {
  it('parses cashu details', () => {
    const parsed = CashuAccountDetailsDbDataSchema.parse({
      mint_url: 'https://mint.test',
      is_test_mint: false,
      keyset_counters: { abc: 3 },
    });
    expect(parsed.mint_url).toBe('https://mint.test');
    expect(parsed.keyset_counters).toEqual({ abc: 3 });
  });

  it('parses spark details', () => {
    expect(
      SparkAccountDetailsDbDataSchema.parse({ network: 'MAINNET' }).network,
    ).toBe('MAINNET');
  });

  it('rejects an unsupported spark network', () => {
    expect(() =>
      SparkAccountDetailsDbDataSchema.parse({ network: 'TESTNET' }),
    ).toThrow();
  });

  it('isCashuAccount / isSparkAccount narrow by type', () => {
    const cashu = { type: 'cashu' } as never;
    const spark = { type: 'spark' } as never;
    expect(isCashuAccount(cashu)).toBe(true);
    expect(isCashuAccount(spark)).toBe(false);
    expect(isSparkAccount(spark)).toBe(true);
    expect(isSparkAccount(cashu)).toBe(false);
  });
});
