import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { evictDerivedKeyQueries } from './session-key-queries';

describe('evictDerivedKeyQueries', () => {
  it('drops every derived-key query (including derivation-path variants) and leaves others', () => {
    const queryClient = new QueryClient();
    const derivedKeys = [
      ['encryption'],
      ['cashu-seed'],
      ['cashu-xpub', "m/0'"],
      ['cashu-private-key', "m/0'"],
      ['spark-mnemonic'],
    ];
    for (const queryKey of derivedKeys) {
      queryClient.setQueryData(queryKey, 'previous-user');
    }
    // An unrelated query must survive the eviction.
    queryClient.setQueryData(['auth-state'], 'keep');

    evictDerivedKeyQueries(queryClient);

    for (const queryKey of derivedKeys) {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    }
    expect(queryClient.getQueryData<string>(['auth-state'])).toBe('keep');
  });
});
