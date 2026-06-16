import {
  type ExtendedMintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
} from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import {
  type AuthProvider,
  type GetKeysResponse,
  type GetKeysetsResponse,
  KeyChain,
  NetworkError,
} from '@cashu/cashu-ts';
import type { MintDataCache } from './mint-cache';
import { type ExtendedCashuWallet, getCashuWallet } from './wallet';

const MINT_TIMEOUT_MS = 10_000;

/**
 * Initializes a Cashu wallet with offline handling. If the mint is offline or
 * times out (10s), returns a minimal offline wallet (isOnline:false); otherwise
 * loads mint info + active keyset keys into the wallet cache.
 */
export async function getInitializedCashuWallet({
  mintCache,
  mintUrl,
  currency,
  bip39seed,
  authProvider,
}: {
  mintCache: MintDataCache;
  mintUrl: string;
  currency: Currency;
  bip39seed?: Uint8Array;
  authProvider?: AuthProvider;
}): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> {
  let mintInfo: ExtendedMintInfo;
  let allMintKeysets: GetKeysetsResponse;
  let mintActiveKeys: GetKeysResponse;

  try {
    [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.race([
      Promise.all([
        mintCache.getMintInfo(mintUrl),
        mintCache.getAllKeysets(mintUrl),
        mintCache.getKeys(mintUrl),
      ]),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new NetworkError('Mint request timed out')),
          MINT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof NetworkError) {
      const wallet = getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed: bip39seed ?? undefined,
        authProvider,
      });
      return { wallet, isOnline: false };
    }
    throw error;
  }

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
    bip39seed: bip39seed ?? undefined,
    authProvider,
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
