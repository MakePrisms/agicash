# cashu-ts v3 migration todo

This file tracks the remaining cleanup after the initial `@cashu/cashu-ts` v3 upgrade.
It is intentionally short and decision-oriented so we can update it as migration work lands.

## Current decisions

- Prefer `wallet.getKeyset(id?)` when the wallet is already initialized and we only need a validated keyset.
- Prefer `await wallet.keyChain.ensureKeysetKeys(keysetId)` before using a persisted historical keyset like `quote.keysetId`.
- Prefer passing `Keyset` directly to `OutputData.createDeterministicData(...)` when only `{ id, keys }` are needed.
- Avoid `keyset.toMintKeys()` unless a full `MintKeys` DTO is specifically required.

## Wallet initialization

`cashu-ts` v3 wants wallets to be initialized with either:

- `await wallet.loadMint()`
- `wallet.loadMintFromCache(mintInfo, keyChainCache)`

For Agicash, the preferred pattern is `loadMintFromCache()`, not `loadMint()`, because we already
prefetch mint info, keysets, and active keys through TanStack Query and want to avoid an extra
network round trip during wallet setup.

### Preferred pattern

1. Fetch mint info, keysets, and active keys through existing query helpers.
2. Build a wallet with `getCashuWallet(mintUrl, { unit, bip39seed })`.
3. Convert prefetched data into the cache shape expected by `wallet.loadMintFromCache(...)`.
4. Call `wallet.loadMintFromCache(mintInfo.cache, keyChainCache)`.
5. Use `ensureKeysetKeys(keysetId)` later when a quote or proof references an older keyset whose
   keys were not part of the initial active-keyset cache.

### Why

- `loadMintFromCache()` is the v3-preferred cache API.
- Constructor-time `mintInfo` / `keys` / `keysets` preload still works in `3.5.0`, but it is
  deprecated upstream.
- Agicash should keep the current "prefetch first, initialize from cached data" architecture even
  after switching to the newer cache API.

## Todo

- [x] Clean up `receive/cashu-receive-quote-service.ts` to use `keyset.keys` directly and
      `ensureKeysetKeys()` for paid quotes.
- [x] Update `features/shared/cashu.ts#getInitializedCashuWallet()` to use
      `wallet.loadMintFromCache(...)` instead of deprecated constructor preload fields.
- [ ] Decide whether to cache only the active keyset at initialization or construct a fuller
      `KeyChainCache` for the whole unit.
- [x] Sweep current send/receive services for redundant `toMintKeys()` null checks after
      `wallet.getKeyset(...)`.
- [x] Simplify `mintProofsBolt11` call in `cashu-receive-quote-service.ts` — pass string quote ID
      instead of constructing a full `MintQuoteBolt11Response` object.
- [x] Use `wallet.receive()` in `cashu-receive-swap-service.ts` instead of `wallet.send()` for
      token claims — semantically correct v3 API.
- [ ] Investigate whether `send/cashu-send-quote-service.ts` can stop rebuilding deterministic
      change outputs manually and switch to `prepareMelt()` + `completeMelt()`.
- [ ] Evaluate `onceMintPaid` / `onceMeltPaid` to simplify subscription managers for
      single-quote Lightning flows.
- [ ] Confirm whether `ensureKeysetKeys(...)` is the final Agicash pattern for persisted
      quote/swap keysets, or whether a fuller `loadMintFromCache(...)` initialization strategy can
      remove most or all explicit calls.
- [x] Revisit the main migration notes in `docs/migrations/cashu-ts-v3.md` so they match the final
      initialization pattern.

## Notes

- `mintInfoQueryOptions()` returns `MintInfo` via `new MintInfo(await new Mint(mintUrl).getInfo())`.
  TanStack Query handles caching instead of Mint's internal lazy cache. When passing to
  `wallet.loadMintFromCache()`, use `mintInfo.cache` to get the raw `GetInfoResponse`.
- `wallet.restore(...)` already calls `ensureKeysetKeys(...)` internally, so recovery paths do not
  need an extra manual guard before restore.
- The paid-quote minting path still benefits from an explicit `ensureKeysetKeys(...)` before output
  generation, because `quote.keysetId` is persisted and can outlive the wallet's initially loaded
  active keyset.
