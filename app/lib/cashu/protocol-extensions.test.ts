import { describe, expect, test } from 'bun:test';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ExtendedMintInfo } from './protocol-extensions';

const baseInfo = {
  name: 'test mint',
  pubkey: '02abcdef',
  version: '0.1.0',
  contact: [],
};

const buildInfo = (nut5: GetInfoResponse['nuts']['5']): GetInfoResponse => ({
  ...baseInfo,
  nuts: {
    '4': { methods: [], disabled: false },
    '5': nut5,
  },
});

describe('ExtendedMintInfo.canMeltAmountless', () => {
  test('returns false when NUT-5 is disabled', () => {
    const info = new ExtendedMintInfo(
      buildInfo({
        disabled: true,
        methods: [
          {
            method: 'bolt11',
            unit: 'sat',
            min_amount: 1,
            max_amount: 1_000_000,
            options: { amountless: true },
          },
        ],
      }),
    );
    expect(info.canMeltAmountless()).toBe(false);
  });

  test('returns false when NUT-5 has no method advertising amountless', () => {
    const info = new ExtendedMintInfo(
      buildInfo({
        disabled: false,
        methods: [
          {
            method: 'bolt11',
            unit: 'sat',
            min_amount: 1,
            max_amount: 1_000_000,
          },
          {
            method: 'bolt12',
            unit: 'sat',
            min_amount: 1,
            max_amount: 1_000_000,
            options: { description: true },
          },
        ],
      }),
    );
    expect(info.canMeltAmountless()).toBe(false);
  });

  test('returns true when bolt11/sat method advertises amountless', () => {
    const info = new ExtendedMintInfo(
      buildInfo({
        disabled: false,
        methods: [
          {
            method: 'bolt11',
            unit: 'sat',
            min_amount: 1,
            max_amount: 1_000_000,
            options: { amountless: true },
          },
        ],
      }),
    );
    expect(info.canMeltAmountless()).toBe(true);
  });

  test('returns false when amountless is advertised on a different unit', () => {
    const info = new ExtendedMintInfo(
      buildInfo({
        disabled: false,
        methods: [
          {
            method: 'bolt11',
            unit: 'usd',
            min_amount: 1,
            max_amount: 1_000_000,
            options: { amountless: true },
          },
        ],
      }),
    );
    expect(info.canMeltAmountless('bolt11', 'sat')).toBe(false);
    expect(info.canMeltAmountless('bolt11', 'usd')).toBe(true);
  });
});
