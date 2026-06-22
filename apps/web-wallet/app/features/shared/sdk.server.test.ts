import { describe, expect, test } from 'bun:test';
import { ServerSdk, createServer } from '@agicash/wallet-sdk';
import { type ServerSdkEnv, buildServerSdkConfig } from './sdk.server';

const baseEnv: ServerSdkEnv = {
  VITE_OPEN_SECRET_API_URL: 'https://os.test',
  VITE_OPEN_SECRET_CLIENT_ID: 'os-client',
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_BREEZ_API_KEY: 'breez-key',
};

const TEST_MNEMONIC =
  'test test test test test test test test test test test junk';
const serverSecrets = {
  SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key',
  LNURL_SERVER_SPARK_MNEMONIC: TEST_MNEMONIC,
};

describe('buildServerSdkConfig', () => {
  test('throws without VITE_SUPABASE_URL', () => {
    expect(() =>
      buildServerSdkConfig({
        lud16Domain: 'agi.cash',
        env: { ...baseEnv, VITE_SUPABASE_URL: '' },
      }),
    ).toThrow('VITE_SUPABASE_URL is not set');
  });

  test('throws without VITE_SUPABASE_ANON_KEY', () => {
    expect(() =>
      buildServerSdkConfig({
        lud16Domain: 'agi.cash',
        env: { ...baseEnv, VITE_SUPABASE_ANON_KEY: '' },
      }),
    ).toThrow('VITE_SUPABASE_ANON_KEY is not set');
  });

  test('maps VITE env + process secrets into a server SdkConfig', () => {
    const cfg = buildServerSdkConfig({
      lud16Domain: 'agi.cash',
      env: baseEnv,
      processEnv: serverSecrets,
    });
    expect(cfg.supabase.serviceRoleKey).toBe('svc-role-key');
    expect(cfg.serverSparkMnemonic).toBe(TEST_MNEMONIC);
    expect(cfg.sparkStorageDir).toBe('/tmp/.spark-data');
    expect(cfg.lud16Domain).toBe('agi.cash');
    // a usable (no-op) StorageProvider — never read server-side, but type-required:
    expect(cfg.storage.persistent.getItem('missing')).toBeNull();
  });
});

describe('createServer construction (server entry smoke)', () => {
  test('builds a ServerSdk from a valid server config (sync, network-free)', () => {
    const sdk = createServer(
      buildServerSdkConfig({
        lud16Domain: 'agi.cash',
        env: baseEnv,
        processEnv: serverSecrets,
      }),
    );
    expect(sdk).toBeInstanceOf(ServerSdk);
  });

  test('throws without serverSparkMnemonic', () => {
    expect(() =>
      createServer(
        buildServerSdkConfig({
          lud16Domain: 'agi.cash',
          env: baseEnv,
          processEnv: { SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key' },
        }),
      ),
    ).toThrow('serverSparkMnemonic');
  });

  test('throws without serviceRoleKey', () => {
    expect(() =>
      createServer(
        buildServerSdkConfig({
          lud16Domain: 'agi.cash',
          env: baseEnv,
          processEnv: { LNURL_SERVER_SPARK_MNEMONIC: TEST_MNEMONIC },
        }),
      ),
    ).toThrow('serviceRoleKey');
  });
});
