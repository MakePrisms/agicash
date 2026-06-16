import { describe, expect, it } from 'bun:test';
import type { DefaultAccountConfig } from '../../config';
import { SdkError } from '../../errors';
import {
  buildDefaultAccountInputs,
  normalizeMintUrl,
  sparkNetworkForBootstrap,
  toAccountInput,
} from './default-accounts';

const sparkBtc: DefaultAccountConfig = {
  type: 'spark',
  currency: 'BTC',
  name: 'Bitcoin',
  network: 'MAINNET',
  purpose: 'transactional',
  isDefault: true,
};
const cashuUsd: DefaultAccountConfig = {
  type: 'cashu',
  currency: 'USD',
  name: 'Testnut USD',
  mintUrl: 'https://testnut.cashu.space/',
  isTestMint: true,
  purpose: 'transactional',
  isDefault: true,
};

describe('default-accounts', () => {
  it('maps a spark config → spark account_input', () => {
    expect(toAccountInput(sparkBtc)).toEqual({
      type: 'spark',
      purpose: 'transactional',
      currency: 'BTC',
      name: 'Bitcoin',
      details: { network: 'MAINNET' },
      is_default: true,
    });
  });

  it('maps a cashu config → cashu account_input with normalized mint url', () => {
    expect(toAccountInput(cashuUsd)).toEqual({
      type: 'cashu',
      purpose: 'transactional',
      currency: 'USD',
      name: 'Testnut USD',
      details: {
        mint_url: 'https://testnut.cashu.space',
        is_test_mint: true,
        keyset_counters: {},
      },
      is_default: true,
    });
  });

  it('normalizeMintUrl strips trailing slash + lowercases host', () => {
    expect(normalizeMintUrl('https://Testnut.Cashu.Space/')).toBe(
      'https://testnut.cashu.space',
    );
  });

  it('buildDefaultAccountInputs requires a BTC Spark account', () => {
    expect(() => buildDefaultAccountInputs([cashuUsd])).toThrow(SdkError);
    expect(buildDefaultAccountInputs([sparkBtc, cashuUsd])).toHaveLength(2);
  });

  it('sparkNetworkForBootstrap lowercases the BTC spark network', () => {
    expect(sparkNetworkForBootstrap([sparkBtc])).toBe('mainnet');
  });
});
