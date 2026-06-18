import { describe, expect, test } from 'bun:test';
import { browserStorage } from '@agicash/opensecret';
import { type ClientSdkEnv, buildClientSdkConfig } from './sdk';

const baseEnv: ClientSdkEnv = {
  VITE_OPEN_SECRET_API_URL: 'https://os.test',
  VITE_OPEN_SECRET_CLIENT_ID: 'os-client',
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_BREEZ_API_KEY: 'breez-key',
  VITE_CASHU_MINT_BLOCKLIST: '[]',
  MODE: 'production',
};

describe('buildClientSdkConfig', () => {
  test('maps the browser env into a client SdkConfig (no service-role, no server mnemonic)', () => {
    const cfg = buildClientSdkConfig({ lud16Domain: 'agi.cash', env: baseEnv });

    expect(cfg.openSecret).toEqual({
      url: 'https://os.test',
      clientId: 'os-client',
    });
    expect(cfg.supabase).toEqual({
      url: 'https://x.supabase.co',
      anonKey: 'anon-key',
    });
    expect(cfg.supabase.serviceRoleKey).toBeUndefined();
    expect(cfg.serverSparkMnemonic).toBeUndefined();
    expect(cfg.breezApiKey).toBe('breez-key');
    expect(cfg.lud16Domain).toBe('agi.cash');
    expect(cfg.sparkStorageDir).toBe('./.spark-data');
    // by reference only — do NOT touch the getters (no window under bun test):
    expect(cfg.storage).toBe(browserStorage);
    expect(cfg.allowLocalhostLightningAddress).toBe(false);
  });

  test('parses VITE_CASHU_MINT_BLOCKLIST into the {mintUrl,unit}[] shape', () => {
    const cfg = buildClientSdkConfig({
      lud16Domain: 'agi.cash',
      env: {
        ...baseEnv,
        VITE_CASHU_MINT_BLOCKLIST: JSON.stringify([
          { mintUrl: 'https://bad.mint', unit: null },
        ]),
      },
    });
    expect(cfg.cashuMintBlocklist).toEqual([
      { mintUrl: 'https://bad.mint', unit: null },
    ]);
  });

  test('production mode → only the BTC spark default account; no expiresAt leaks through', () => {
    const cfg = buildClientSdkConfig({
      lud16Domain: 'agi.cash',
      env: { ...baseEnv, MODE: 'production' },
    });
    expect(cfg.defaultAccounts).toEqual([
      {
        type: 'spark',
        currency: 'BTC',
        name: 'Bitcoin',
        network: 'MAINNET',
        isDefault: true,
        purpose: 'transactional',
      },
    ]);
    expect('expiresAt' in (cfg.defaultAccounts?.[0] ?? {})).toBe(false);
  });

  test('development mode → adds the two testnut cashu accounts + allowLocalhost', () => {
    const cfg = buildClientSdkConfig({
      lud16Domain: 'agi.cash',
      env: { ...baseEnv, MODE: 'development' },
    });
    expect(cfg.defaultAccounts).toHaveLength(3);
    expect(cfg.allowLocalhostLightningAddress).toBe(true);
    expect(cfg.defaultAccounts?.filter((a) => a.type === 'cashu')).toHaveLength(
      2,
    );
  });
});
