import { ExtendedMintInfo } from '@agicash/cashu';
import {
  type GetKeysResponse,
  type GetKeysetsResponse,
  Mint,
} from '@cashu/cashu-ts';

const ONE_HOUR_MS = 1000 * 60 * 60;

type Entry<T> = { value: Promise<T>; expiresAt: number };

/**
 * In-memory TTL cache (1h) of mint info / keysets / keys, replacing the app's
 * mintInfoQueryOptions / allMintKeysetsQueryOptions / mintKeysQueryOptions.
 * Concurrent callers share one in-flight request; a rejected fetch is evicted so
 * the next call retries.
 */
export class MintDataCache {
  private readonly info = new Map<string, Entry<ExtendedMintInfo>>();
  private readonly keysets = new Map<string, Entry<GetKeysetsResponse>>();
  private readonly keys = new Map<string, Entry<GetKeysResponse>>();

  getMintInfo(mintUrl: string): Promise<ExtendedMintInfo> {
    return this.cached(
      this.info,
      mintUrl,
      async () => new ExtendedMintInfo(await new Mint(mintUrl).getInfo()),
    );
  }

  getAllKeysets(mintUrl: string): Promise<GetKeysetsResponse> {
    return this.cached(this.keysets, mintUrl, () =>
      new Mint(mintUrl).getKeySets(),
    );
  }

  getKeys(mintUrl: string): Promise<GetKeysResponse> {
    return this.cached(this.keys, mintUrl, () => new Mint(mintUrl).getKeys());
  }

  private cached<T>(
    store: Map<string, Entry<T>>,
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = fetcher().catch((error) => {
      store.delete(key);
      throw error;
    });
    store.set(key, { value, expiresAt: now + ONE_HOUR_MS });
    return value;
  }

  clear(): void {
    this.info.clear();
    this.keysets.clear();
    this.keys.clear();
  }
}
