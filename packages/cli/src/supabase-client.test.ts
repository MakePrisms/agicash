// packages/cli/src/supabase-client.test.ts
import { describe, expect, test } from 'bun:test';
import { validateSupabaseEnv } from './supabase-client';

describe('supabase client config', () => {
  test('validateSupabaseEnv returns error when SUPABASE_URL is missing', () => {
    const result = validateSupabaseEnv({ SUPABASE_ANON_KEY: 'key' });
    expect(result).toEqual({
      ok: false,
      error:
        'SUPABASE_URL is required for cloud sync. Set it in ~/.agicash/.env, ./.env, or the shell environment.',
    });
  });

  test('validateSupabaseEnv returns error when SUPABASE_ANON_KEY is missing', () => {
    const result = validateSupabaseEnv({
      SUPABASE_URL: 'https://x.supabase.co',
    });
    expect(result).toEqual({
      ok: false,
      error:
        'SUPABASE_ANON_KEY is required for cloud sync. Set it in ~/.agicash/.env, ./.env, or the shell environment.',
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

  test('validateSupabaseEnv succeeds with bundled release defaults', () => {
    const result = validateSupabaseEnv({
      AGICASH_RELEASE_SUPABASE_URL: 'https://release.supabase.co',
      AGICASH_RELEASE_SUPABASE_ANON_KEY: 'release-key',
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://release.supabase.co',
      anonKey: 'release-key',
    });
  });
});
