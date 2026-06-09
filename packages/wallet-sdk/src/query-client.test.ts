import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import { getQueryClient } from './query-client';

describe('getQueryClient', () => {
  it('returns a QueryClient', () => {
    expect(getQueryClient()).toBeInstanceOf(QueryClient);
  });

  // bun test runs with no `window`, so isServer is true -> the per-request path.
  it('returns a fresh client per call in a server context', () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
});
