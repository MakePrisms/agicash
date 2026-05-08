import { describe, expect, test } from 'bun:test';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { validateBolt11 } from './validation';

const buildDecoded = (
  overrides: Partial<DecodedBolt11> = {},
): DecodedBolt11 => ({
  amountMsat: 250_000_000,
  amountSat: 250_000,
  createdAtUnixMs: Date.now(),
  expiryUnixMs: Date.now() + 60_000,
  network: 'bitcoin',
  description: undefined,
  paymentHash:
    '0001020304050607080900010203040506070809000102030405060708090102',
  ...overrides,
});

describe('validateBolt11', () => {
  test('passes a non-zero amount invoice without allowZeroAmount', () => {
    const result = validateBolt11(buildDecoded());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.amount?.toNumber('sat')).toBe(250_000);
    }
  });

  test('rejects amountless invoices by default', () => {
    const result = validateBolt11(
      buildDecoded({ amountMsat: undefined, amountSat: undefined }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/amount/i);
    }
  });

  test('accepts amountless invoices with allowZeroAmount: true', () => {
    const result = validateBolt11(
      buildDecoded({ amountMsat: undefined, amountSat: undefined }),
      { allowZeroAmount: true },
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.amount).toBeNull();
      expect(result.currency).toBe('BTC');
    }
  });

  test('rejects non-bitcoin networks even when allowZeroAmount is true', () => {
    const result = validateBolt11(
      buildDecoded({ network: 'testnet', amountMsat: undefined }),
      { allowZeroAmount: true },
    );
    expect(result.valid).toBe(false);
  });
});
