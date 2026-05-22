import { describe, expect, test } from 'bun:test';
import {
  USDB_MAINNET_ID,
  convertUsdbToMoney,
  getSparkAccountNumber,
  getSparkStableBalanceConfig,
} from './usdb';

describe('USDB_MAINNET_ID', () => {
  test('is the canonical mainnet token identifier', () => {
    expect(USDB_MAINNET_ID).toBe(
      'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87',
    );
  });
});

describe('convertUsdbToMoney', () => {
  test('zero balance → $0.00', () => {
    const m = convertUsdbToMoney(0n);
    expect(m.toNumber('usd')).toBe(0);
    expect(m.currency).toBe('USD');
  });

  test('1 USDB (1_000_000 base units) → $1.00', () => {
    const m = convertUsdbToMoney(1_000_000n);
    expect(m.toNumber('usd')).toBe(1);
  });

  test('123.456789 USDB rounds to nearest cent ($123.46)', () => {
    const m = convertUsdbToMoney(123_456_789n);
    expect(m.toNumber('cent')).toBe(12346);
  });

  test('exactly half-cent rounds away from zero (0.005 → $0.01)', () => {
    const m = convertUsdbToMoney(5_000n);
    expect(m.toNumber('cent')).toBe(1);
  });

  test('very large balance does not lose precision in the cent range', () => {
    const m = convertUsdbToMoney(1_000_000_500_000n);
    expect(m.toNumber('cent')).toBe(100_000_050);
  });
});

describe('getSparkAccountNumber', () => {
  test('BTC → 1', () => {
    expect(getSparkAccountNumber('BTC')).toBe(1);
  });

  test('USD → 2', () => {
    expect(getSparkAccountNumber('USD')).toBe(2);
  });
});

describe('getSparkStableBalanceConfig', () => {
  test('returns undefined for BTC', () => {
    expect(getSparkStableBalanceConfig('BTC', 'MAINNET')).toBeUndefined();
  });

  test('returns USDB config for USD on MAINNET', () => {
    const cfg = getSparkStableBalanceConfig('USD', 'MAINNET');
    expect(cfg).toEqual({
      tokens: [{ label: 'USDB', tokenIdentifier: USDB_MAINNET_ID }],
      defaultActiveLabel: 'USDB',
      thresholdSats: 0,
    });
  });

  test('returns undefined for USD on REGTEST (no test token configured)', () => {
    expect(getSparkStableBalanceConfig('USD', 'REGTEST')).toBeUndefined();
  });
});
