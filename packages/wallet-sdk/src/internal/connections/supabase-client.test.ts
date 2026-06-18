import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from '../../config';

const calls: unknown[][] = [];
mock.module('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    calls.push(args);
    return {};
  },
}));

const { createBrowserClient, createServerClient } = await import(
  './supabase-client'
);

// bun's mock.module is process-global; restore after this file so its
// @supabase/supabase-js mock stays isolated from other files mocking it.
afterAll(() => mock.restore());

const baseConfig: SdkConfig = {
  openSecret: { url: 'https://os.test', clientId: 'cid' },
  supabase: {
    url: 'https://sb.test',
    anonKey: 'anon-key',
    serviceRoleKey: 'service-role-key',
  },
  storage: {} as SdkConfig['storage'],
  lud16Domain: 'agi.cash',
};

describe('createBrowserClient', () => {
  it('calls createClient with url, anonKey, accessToken, and schema=wallet', () => {
    calls.length = 0;
    const getToken = async () => 'token';
    createBrowserClient(baseConfig, getToken);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'https://sb.test',
      'anon-key',
      { accessToken: getToken, db: { schema: 'wallet' } },
    ]);
  });
});

describe('createServerClient', () => {
  it('calls createClient with url, serviceRoleKey, and schema=wallet', () => {
    calls.length = 0;
    createServerClient(baseConfig);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'https://sb.test',
      'service-role-key',
      { db: { schema: 'wallet' } },
    ]);
  });

  it('throws when serviceRoleKey is absent', () => {
    const configNoKey: SdkConfig = {
      ...baseConfig,
      supabase: { url: 'https://sb.test', anonKey: 'anon-key' },
    };
    expect(() => createServerClient(configNoKey)).toThrow(
      'createServerClient requires supabase.serviceRoleKey',
    );
  });
});
