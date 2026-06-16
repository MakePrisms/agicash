import type { AuthProvider } from '@cashu/cashu-ts';
import { KeyChain, NetworkError } from '@cashu/cashu-ts';
import type { Currency } from '@agicash/money';
import {
  type ExtendedCashuWallet,
  ExtendedMintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '../lib/cashu';

/** Mint metadata fetched once per mint URL (mirrors master's 1h-staleTime queries). */
export type MintMetadata = {
  mintInfo: ExtendedMintInfo;
  keysets: Awaited<ReturnType<import('@cashu/cashu-ts').Mint['getKeySets']>>;
  keys: Awaited<ReturnType<import('@cashu/cashu-ts').Mint['getKeys']>>;
};

export type InitializedCashuWallet = {
  wallet: ExtendedCashuWallet;
  isOnline: boolean;
};

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Builds the live cashu wallet handle for an account. Caches mint metadata per
 * mint URL (replacing the web's TanStack mint-info/keysets/keys queries) and
 * rebuilds the cheap `ExtendedCashuWallet` per call. On a network failure/timeout
 * returns a minimal offline wallet (`isOnline:false`), matching master.
 */
export class CashuWalletService {
  private readonly metadata = new Map<string, Promise<MintMetadata>>();

  constructor(
    private readonly fetchMintMetadata: (
      mintUrl: string,
    ) => Promise<MintMetadata>,
  ) {}

  async getInitialized(
    mintUrl: string,
    currency: Currency,
    bip39seed: Uint8Array | undefined,
    authProvider: AuthProvider | undefined,
  ): Promise<InitializedCashuWallet> {
    const buildOffline = (): InitializedCashuWallet => ({
      wallet: getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed,
        authProvider,
      }),
      isOnline: false,
    });

    let meta: MintMetadata;
    try {
      meta = await this.withTimeout(this.getMetadata(mintUrl));
    } catch (error) {
      this.metadata.delete(mintUrl); // don't cache a failed fetch
      if (error instanceof NetworkError) return buildOffline();
      throw error;
    }

    const protocolUnit = getCashuProtocolUnit(currency);
    const unitKeysets = meta.keysets.keysets.filter(
      (ks) => ks.unit === protocolUnit,
    );
    const activeKeyset = unitKeysets.find((ks) => ks.active);
    if (!activeKeyset) {
      throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
    }
    const activeKeysForUnit = meta.keys.keysets.find(
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
      authProvider,
    });
    const keyChainCache = KeyChain.mintToCacheDTO(
      wallet.unit,
      mintUrl,
      unitKeysets,
      [activeKeysForUnit],
    );
    wallet.loadMintFromCache(meta.mintInfo.cache, keyChainCache);
    return { wallet, isOnline: true };
  }

  private getMetadata(mintUrl: string): Promise<MintMetadata> {
    const existing = this.metadata.get(mintUrl);
    if (existing) return existing;
    const promise = this.fetchMintMetadata(mintUrl);
    this.metadata.set(mintUrl, promise);
    return promise;
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new NetworkError('Mint request timed out')),
          FETCH_TIMEOUT_MS,
        ),
      ),
    ]);
  }
}
