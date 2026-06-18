import { describe, expect, test } from 'bun:test';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '~/features/accounts/account';
import { ExtendedMintInfo } from '~/lib/cashu/protocol-extensions';
import { canAccountPayAmountlessBolt11 } from './send-store';

const baseInfo = {
  name: 'test mint',
  pubkey: '02abcdef',
  version: '0.1.0',
  contact: [],
};

const buildMintInfo = (
  nut5: GetInfoResponse['nuts']['5'],
): ExtendedMintInfo => {
  return new ExtendedMintInfo({
    ...baseInfo,
    nuts: {
      '4': { methods: [], disabled: false },
      '5': nut5,
    },
  });
};

const buildCashuAccount = (mintInfo: ExtendedMintInfo): CashuAccount => {
  return {
    type: 'cashu',
    currency: 'BTC',
    wallet: { getMintInfo: () => mintInfo },
  } as unknown as CashuAccount;
};

const sparkAccount: SparkAccount = { type: 'spark' } as unknown as SparkAccount;

describe('canAccountPayAmountlessBolt11', () => {
  test('returns true for spark accounts unconditionally', () => {
    expect(canAccountPayAmountlessBolt11(sparkAccount as Account)).toBe(true);
  });

  test('returns false when NUT-5 is disabled even if amountless is advertised', () => {
    const account = buildCashuAccount(
      buildMintInfo({
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
    expect(canAccountPayAmountlessBolt11(account as Account)).toBe(false);
  });

  test('returns false when NUT-5 has no method advertising amountless', () => {
    const account = buildCashuAccount(
      buildMintInfo({
        disabled: false,
        methods: [
          {
            method: 'bolt11',
            unit: 'sat',
            min_amount: 1,
            max_amount: 1_000_000,
          },
        ],
      }),
    );
    expect(canAccountPayAmountlessBolt11(account as Account)).toBe(false);
  });

  test('returns true when bolt11/sat method advertises amountless', () => {
    const account = buildCashuAccount(
      buildMintInfo({
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
    expect(canAccountPayAmountlessBolt11(account as Account)).toBe(true);
  });

  test('returns false when amountless is advertised on a different unit', () => {
    const account = buildCashuAccount(
      buildMintInfo({
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
    // Account's currency is BTC, which maps to cashu unit 'sat'.
    expect(canAccountPayAmountlessBolt11(account as Account)).toBe(false);
  });
});
