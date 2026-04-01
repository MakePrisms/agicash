// packages/cli/src/supabase-client.test.ts
import { describe, expect, test } from 'bun:test';
import { validateSupabaseEnv } from './supabase-client';

describe('supabase client config', () => {
  test('validateSupabaseEnv returns error when SUPABASE_URL is missing', () => {
    const result = validateSupabaseEnv({ SUPABASE_ANON_KEY: 'key' });
    expect(result).toEqual({
      ok: false,
      error: 'SUPABASE_URL is required in .env for cloud sync',
    });
  });

  test('validateSupabaseEnv returns error when SUPABASE_ANON_KEY is missing', () => {
    const result = validateSupabaseEnv({
      SUPABASE_URL: 'https://x.supabase.co',
    });
    expect(result).toEqual({
      ok: false,
      error: 'SUPABASE_ANON_KEY is required in .env for cloud sync',
    });
  });

  test('validateSupabaseEnv succeeds with both vars', () => {
    const result = validateSupabaseEnv({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'key123',
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://x.supabase.co',
      anonKey: 'key123',
    });
  });
});
