import { describe, expect, it } from 'bun:test';
import * as sdk from './index';

describe('public barrel — server surface', () => {
  it('re-exports createServer', () => {
    expect(typeof sdk.createServer).toBe('function');
  });
});

describe('public barrel — account value helpers', () => {
  it('barrel exports the account value helpers', () => {
    expect(typeof sdk.getAccountBalance).toBe('function');
    expect(typeof sdk.getExtendedAccounts).toBe('function');
    expect(typeof sdk.isDefaultAccount).toBe('function');
    expect(typeof sdk.canSendToLightning).toBe('function');
    expect(typeof sdk.canReceiveFromLightning).toBe('function');
  });
});

describe('public barrel — cashu mint blocklist', () => {
  it('re-exports MintBlocklistSchema (value) so consumers can parse their env JSON', () => {
    expect(typeof sdk.MintBlocklistSchema).toBe('object'); // a zod/mini schema object
    const parsed = sdk.MintBlocklistSchema.parse([
      { mintUrl: 'https://mint.example.com', unit: null },
    ]);
    expect(parsed).toEqual([
      { mintUrl: 'https://mint.example.com', unit: null },
    ]);
  });
});
