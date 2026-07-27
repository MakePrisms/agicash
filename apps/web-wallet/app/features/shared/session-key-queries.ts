import type { QueryClient } from '@tanstack/react-query';

// Shared head segment for every session-derived-key query — encryption, cashu
// seed/xpub/private-key, and spark mnemonic — which cache Open Secret derivations
// with an infinity stale time. Keying them all under this prefix lets one
// partial-prefix removeQueries drop them (and any future derived-key query) on an
// auth change, so a cross-user login can't read — or leave a consumer holding a
// revoked — the previous session's key material. The query defs import this, so
// the defs and the eviction share one source of truth.
export const derivedKeyQueryPrefix = 'derived-key';

/**
 * Drops every cached derived-key query — a partial-prefix match on
 * {@link derivedKeyQueryPrefix}, so the parameterized derivation-path variants go
 * too — so the next session derives fresh.
 */
export const evictDerivedKeyQueries = (queryClient: QueryClient): void => {
  queryClient.removeQueries({ queryKey: [derivedKeyQueryPrefix] });
};
