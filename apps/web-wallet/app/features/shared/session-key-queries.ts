import type { QueryClient } from '@tanstack/react-query';

// The derived-key queries — encryption, cashu seed/xpub/private-key, and spark
// mnemonic — cache Open Secret derivations with an infinity stale time. A
// cross-user login without a prior sign-out (sign-out clears the whole cache)
// must evict them so the next user re-derives, rather than reading — or being
// left holding a revoked — previous session's key material. Prefixes evict the
// parameterized derivation-path variants too.
const derivedKeyQueryKeys = [
  ['encryption'],
  ['cashu-seed'],
  ['cashu-xpub'],
  ['cashu-private-key'],
  ['spark-mnemonic'],
];

/** Drops every cached derived-key query so the next session derives fresh. */
export const evictDerivedKeyQueries = (queryClient: QueryClient): void => {
  for (const queryKey of derivedKeyQueryKeys) {
    queryClient.removeQueries({ queryKey });
  }
};
