import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { seedQueryOptions, xpubQueryOptions } from './cashu-query-options';
import { encryptionQueryOptions } from './encryption-hooks';
import {
  derivedKeyQueryPrefix,
  evictDerivedKeyQueries,
} from './session-key-queries';
import { sparkMnemonicQueryOptions } from './spark-query-options';

describe('evictDerivedKeyQueries', () => {
  it('drops every derived-key query under the shared prefix (incl. derivation-path variants) in one removeQueries, and leaves others', () => {
    const queryClient = new QueryClient();
    // The five derived-key queries, each under the shared prefix, mirroring the
    // shapes the query defs produce (two carry a derivation-path segment).
    const derivedKeys = [
      [derivedKeyQueryPrefix, 'encryption'],
      [derivedKeyQueryPrefix, 'cashu-seed'],
      [derivedKeyQueryPrefix, 'cashu-xpub', "m/0'"],
      [derivedKeyQueryPrefix, 'cashu-private-key', "m/0'"],
      [derivedKeyQueryPrefix, 'spark-mnemonic'],
    ];
    for (const queryKey of derivedKeys) {
      queryClient.setQueryData(queryKey, 'previous-user');
    }
    // A non-derived query must survive the prefix eviction.
    queryClient.setQueryData(['auth-state'], 'keep');

    evictDerivedKeyQueries(queryClient);

    for (const queryKey of derivedKeys) {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    }
    expect(queryClient.getQueryData<string>(['auth-state'])).toBe('keep');
  });
});

describe('derived-key query defs', () => {
  it('key every derived-key query under the shared prefix, so evictDerivedKeyQueries drops them', () => {
    // Asserts the defs themselves adopt the prefix: a def regressing to a bare
    // key — a silent cache-key mismatch typecheck cannot catch — fails here, not
    // only in the grep gate. Covers the cashu-xpub derivation-path variant both
    // with and without a path.
    const queryClient = new QueryClient();
    const derivedKeyDefs = [
      encryptionQueryOptions().queryKey,
      seedQueryOptions().queryKey,
      xpubQueryOptions({ queryClient, derivationPath: "m/0'" }).queryKey,
      xpubQueryOptions({ queryClient }).queryKey,
      sparkMnemonicQueryOptions().queryKey,
    ];
    for (const queryKey of derivedKeyDefs) {
      expect(queryKey[0]).toBe(derivedKeyQueryPrefix);
    }
  });
});
