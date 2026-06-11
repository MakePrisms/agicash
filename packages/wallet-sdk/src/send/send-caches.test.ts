import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { CashuSendQuote } from './cashu-send-quote';
import { UnresolvedCashuSendQuotesCache } from './cashu-send-quote-cache';
import type { CashuSendSwap } from './cashu-send-swap';
import {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
} from './cashu-send-swap-cache';
import type { SparkSendQuote } from './spark-send-quote';
import { UnresolvedSparkSendQuotesCache } from './spark-send-quote-cache';

const cashuQuote = (id: string, version: number) =>
  ({ id, version, quoteId: `melt-${id}` }) as unknown as CashuSendQuote;

const sparkQuote = (id: string, version: number) =>
  ({ id, version }) as unknown as SparkSendQuote;

const swap = (id: string, version: number) =>
  ({ id, version }) as unknown as CashuSendSwap;

describe('UnresolvedCashuSendQuotesCache', () => {
  it('update applies only newer versions', () => {
    const queryClient = new QueryClient();
    const cache = new UnresolvedCashuSendQuotesCache(queryClient);
    cache.add(cashuQuote('a', 2));
    cache.update(cashuQuote('a', 1));
    expect(cache.get('a')?.version).toBe(2);
    cache.update(cashuQuote('a', 3));
    expect(cache.get('a')?.version).toBe(3);
  });

  it('getByMeltQuoteId finds by the melt quote id and remove deletes', () => {
    const queryClient = new QueryClient();
    const cache = new UnresolvedCashuSendQuotesCache(queryClient);
    cache.add(cashuQuote('a', 1));
    cache.add(cashuQuote('b', 1));
    expect(cache.getByMeltQuoteId('melt-b')?.id).toBe('b');
    cache.remove(cashuQuote('a', 1));
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('UnresolvedSparkSendQuotesCache.update (version guard)', () => {
  it('ignores older versions and applies newer ones', () => {
    const queryClient = new QueryClient();
    const cache = new UnresolvedSparkSendQuotesCache(queryClient);
    cache.add(sparkQuote('a', 2));
    cache.update(sparkQuote('a', 1));
    expect(cache.get('a')?.version).toBe(2);
    cache.update(sparkQuote('a', 3));
    expect(cache.get('a')?.version).toBe(3);
  });
});

describe('CashuSendSwapCache.updateIfExists (version guard)', () => {
  it('leaves the cache empty when the swap was never added', () => {
    const queryClient = new QueryClient();
    const cache = new CashuSendSwapCache(queryClient);
    cache.updateIfExists(swap('a', 2));
    expect(
      queryClient.getQueryData([CashuSendSwapCache.Key, 'a']),
    ).toBeUndefined();
  });

  it('ignores older versions and applies newer ones', () => {
    const queryClient = new QueryClient();
    const cache = new CashuSendSwapCache(queryClient);
    cache.add(swap('a', 2));
    cache.updateIfExists(swap('a', 1));
    expect(
      queryClient.getQueryData<CashuSendSwap>([CashuSendSwapCache.Key, 'a'])
        ?.version,
    ).toBe(2);
    cache.updateIfExists(swap('a', 3));
    expect(
      queryClient.getQueryData<CashuSendSwap>([CashuSendSwapCache.Key, 'a'])
        ?.version,
    ).toBe(3);
  });
});

describe('UnresolvedCashuSendSwapsCache.update (version guard)', () => {
  it('ignores older versions and applies newer ones', () => {
    const queryClient = new QueryClient();
    const cache = new UnresolvedCashuSendSwapsCache(queryClient);
    cache.add(swap('a', 2));
    cache.update(swap('a', 1));
    cache.update(swap('a', 3));
    const all = queryClient.getQueryData<CashuSendSwap[]>([
      UnresolvedCashuSendSwapsCache.Key,
    ]);
    expect(all?.find((s) => s.id === 'a')?.version).toBe(3);
  });
});
