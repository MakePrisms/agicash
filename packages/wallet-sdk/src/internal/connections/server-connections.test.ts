import { describe, expect, it } from 'bun:test';
import type { SdkConfig } from '../../config';
import { inMemoryStorage } from '../test-support';
import { buildServerConnections } from './server-connections';

const baseConfig = (): SdkConfig => ({
  openSecret: { url: 'https://os.test', clientId: 'cid' },
  supabase: {
    url: 'https://sb.test',
    anonKey: 'anon',
    serviceRoleKey: 'service-role',
  },
  breezApiKey: 'breez-key',
  sparkStorageDir: '/tmp/.spark-data',
  storage: inMemoryStorage(),
  lud16Domain: 'agi.cash',
  serverSparkMnemonic: 'abandon abandon abandon … art',
});

describe('buildServerConnections', () => {
  it('assembles the server bundle (service-role supabase + server spark + cashu wallets)', () => {
    const conns = buildServerConnections(baseConfig());
    expect(conns.supabase).toBeDefined();
    expect(conns.sparkWallets).toBeDefined();
    expect(conns.cashuWallets).toBeDefined();
  });

  it('throws when serverSparkMnemonic is missing', () => {
    const { serverSparkMnemonic, ...config } = baseConfig();
    expect(() => buildServerConnections(config as SdkConfig)).toThrow(
      /serverSparkMnemonic/,
    );
  });

  it('throws when serviceRoleKey is missing (createServerClient guard)', () => {
    const config = baseConfig();
    config.supabase = {
      url: config.supabase.url,
      anonKey: config.supabase.anonKey,
    };
    expect(() => buildServerConnections(config)).toThrow(/serviceRoleKey/);
  });
});
