/**
 * Internal cashu wallet initialiser — Slice 3 (cashu + spark).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/shared/cashu.ts#getInitializedCashuWallet` (+ the
 * `mintInfoQueryOptions` / `allMintKeysetsQueryOptions` / `mintKeysQueryOptions` it reads).
 * Builds a cashu account's LIVE handle: an {@link ExtendedCashuWallet} (cashu-ts wallet +
 * seed) with the mint's protocol metadata (info / keysets / active keys) loaded from cache,
 * and an `isOnline` flag. The contract calls this the per-mint protocol-metadata memo
 * (§0 state kind 2, honoring the 1 h staleTime).
 *
 * Re-housing vs master:
 *  - Master fetches the three mint endpoints through a `QueryClient` (1 h `staleTime` memo)
 *    and races them against a 10 s timeout that `queryClient.cancelQueries` cancels. Here a
 *    framework-free {@link MintMetadataCache} provides the same 1 h memo (keyed by mint URL),
 *    and the timeout rejects with a cashu-ts `NetworkError` (the same offline signal master
 *    keys off) — there is no query to cancel, so the in-flight fetches are simply abandoned.
 *  - The `measureOperation` performance wrapper is dropped (web-only telemetry, §3).
 *  - On `NetworkError` (offline OR timeout) it returns a wallet with NO loaded keys +
 *    `isOnline: false`, exactly as master; any other error propagates.
 *
 * The memo is INSTANCE state (held by the resolver), not a module global — multiple SDK
 * instances do not share it, and `Sdk.destroy()` drops it with the resolver.
 *
 * @module
 */
import {
  KeyChain,
  type Mint as MintClass,
  Mint,
  NetworkError,
} from '@cashu/cashu-ts';
import type { GetKeysResponse, GetKeysetsResponse } from '@cashu/cashu-ts';
import { getCashuUnit } from './lib-cashu';
import {
  type ExtendedCashuWallet,
  ExtendedMintInfo,
  getCashuProtocolUnit,
  getCashuWallet,
} from './lib-cashu-wallet';
import type { Currency } from '../types/money';

/** How long fetched mint metadata stays fresh — matches master's 1 h `staleTime`. */
const MINT_METADATA_TTL_MS = 1000 * 60 * 60;

/** How long to wait for the networked mint metadata before declaring the mint offline. */
const MINT_REQUEST_TIMEOUT_MS = 10_000;

/** The mint protocol metadata needed to load a wallet from cache. */
type MintMetadata = {
  mintInfo: ExtendedMintInfo;
  allMintKeysets: GetKeysetsResponse;
  mintActiveKeys: GetKeysResponse;
};

type CacheEntry = {
  fetchedAt: number;
  value: Promise<MintMetadata>;
};

/**
 * A tiny per-mint-URL TTL memo for the (info / keysets / keys) protocol metadata — the
 * framework-free stand-in for master's `QueryClient` 1 h `staleTime` cache. A stale or
 * absent entry triggers one fetch; concurrent callers within the window share it. A fetch
 * that rejects is NOT cached (the next call retries), so a transient mint outage does not
 * pin an offline result for an hour.
 */
export class MintMetadataCache {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * @param now - clock injection for tests (defaults to `Date.now`).
   * @param createMint - mint-client factory injection for tests (defaults to cashu-ts `Mint`).
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly createMint: (mintUrl: string) => MintClass = (mintUrl) =>
      new Mint(mintUrl),
  ) {}

  /** Fetch (or return memoised) the protocol metadata for `mintUrl`. */
  get(mintUrl: string): Promise<MintMetadata> {
    const existing = this.entries.get(mintUrl);
    if (existing && this.now() - existing.fetchedAt < MINT_METADATA_TTL_MS) {
      return existing.value;
    }
    const value = this.fetch(mintUrl);
    this.entries.set(mintUrl, { fetchedAt: this.now(), value });
    // Don't pin a rejected fetch — drop it so the next call retries.
    value.catch(() => {
      if (this.entries.get(mintUrl)?.value === value) {
        this.entries.delete(mintUrl);
      }
    });
    return value;
  }

  /** Drop all memoised metadata (called when the resolver / SDK is torn down). */
  clear(): void {
    this.entries.clear();
  }

  private async fetch(mintUrl: string): Promise<MintMetadata> {
    const mint = this.createMint(mintUrl);
    const [info, allMintKeysets, mintActiveKeys] = await Promise.all([
      mint.getInfo(),
      mint.getKeySets(),
      mint.getKeys(),
    ]);
    return {
      mintInfo: new ExtendedMintInfo(info),
      allMintKeysets,
      mintActiveKeys,
    };
  }
}

/**
 * Race `promise` against a {@link MINT_REQUEST_TIMEOUT_MS} timer that rejects with a cashu-ts
 * `NetworkError` — so a hung mint surfaces the SAME offline signal master's timeout does.
 */
function withMintTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new NetworkError('Mint request timed out')),
        MINT_REQUEST_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Initialise a cashu wallet with offline handling, mirroring master
 * `getInitializedCashuWallet`. Fetches the mint's protocol metadata (memoised, timed out),
 * builds an {@link ExtendedCashuWallet} for the account's unit, and loads the active keyset's
 * keys into it from cache. If the mint is offline or times out (a `NetworkError`), returns a
 * keyless wallet with `isOnline: false`; any other error propagates.
 *
 * @param params.cache - the per-mint metadata memo (held by the resolver).
 * @param params.mintUrl - the mint URL.
 * @param params.currency - the account currency (selects the cashu unit + keyset).
 * @param params.bip39seed - optional BIP39 seed for deterministic-secret operations.
 * @returns the live wallet + whether the mint was reachable.
 * @throws Error if the mint is reachable but has no active keyset / keys for the currency.
 */
export async function getInitializedCashuWallet({
  cache,
  mintUrl,
  currency,
  bip39seed,
}: {
  cache: MintMetadataCache;
  mintUrl: string;
  currency: Currency;
  bip39seed?: Uint8Array;
}): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> {
  let metadata: MintMetadata;
  try {
    metadata = await withMintTimeout(cache.get(mintUrl));
  } catch (error) {
    if (error instanceof NetworkError) {
      const wallet = getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed,
      });
      return { wallet, isOnline: false };
    }
    throw error;
  }

  const { mintInfo, allMintKeysets, mintActiveKeys } = metadata;

  const unitKeysets = allMintKeysets.keysets.filter(
    (ks) => ks.unit === getCashuProtocolUnit(currency),
  );
  const activeKeyset = unitKeysets.find((ks) => ks.active);
  if (!activeKeyset) {
    throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
  }

  const activeKeysForUnit = mintActiveKeys.keysets.find(
    (ks) => ks.id === activeKeyset.id,
  );
  if (!activeKeysForUnit) {
    throw new Error(
      `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
    );
  }

  const wallet = getCashuWallet(mintUrl, {
    unit: getCashuUnit(currency),
    bip39seed,
  });
  const keyChainCache = KeyChain.mintToCacheDTO(
    wallet.unit,
    mintUrl,
    unitKeysets,
    [activeKeysForUnit],
  );
  wallet.loadMintFromCache(mintInfo.cache, keyChainCache);

  return { wallet, isOnline: true };
}
