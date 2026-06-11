import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from './cashu-receive-quote-cache';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import { PendingCashuReceiveSwapsCache } from './cashu-receive-swap-cache';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from './spark-receive-quote-cache';

const cashuQuote = (id: string, version: number, state = 'UNPAID') =>
  ({
    id,
    version,
    state,
    quoteId: `mint-${id}`,
  }) as unknown as CashuReceiveQuote;

const sparkQuote = (id: string, version: number, state = 'UNPAID') =>
  ({ id, version, state }) as unknown as SparkReceiveQuote;

const swap = (tokenHash: string, version: number, state = 'PENDING') =>
  ({ tokenHash, version, state }) as unknown as CashuReceiveSwap;

describe('CashuReceiveQuoteCache.updateIfExists (version guard)', () => {
  it('leaves the cache empty when the quote was never added', () => {
    const queryClient = new QueryClient();
    const cache = new CashuReceiveQuoteCache(queryClient);
    cache.updateIfExists(cashuQuote('a', 2));
    expect(
      queryClient.getQueryData([CashuReceiveQuoteCache.Key, 'a']),
    ).toBeUndefined();
  });

  it('ignores an older or equal version', () => {
    const queryClient = new QueryClient();
    const cache = new CashuReceiveQuoteCache(queryClient);
    cache.add(cashuQuote('a', 2));
    cache.updateIfExists(cashuQuote('a', 1));
    cache.updateIfExists(cashuQuote('a', 2));
    expect(
      queryClient.getQueryData<CashuReceiveQuote>([
        CashuReceiveQuoteCache.Key,
        'a',
      ])?.version,
    ).toBe(2);
  });

  it('applies a newer version', () => {
    const queryClient = new QueryClient();
    const cache = new CashuReceiveQuoteCache(queryClient);
    cache.add(cashuQuote('a', 1));
    cache.updateIfExists(cashuQuote('a', 3));
    expect(
      queryClient.getQueryData<CashuReceiveQuote>([
        CashuReceiveQuoteCache.Key,
        'a',
      ])?.version,
    ).toBe(3);
  });
});

describe('PendingCashuReceiveQuotesCache', () => {
  it('update applies only newer versions', () => {
    const queryClient = new QueryClient();
    const cache = new PendingCashuReceiveQuotesCache(queryClient);
    cache.add(cashuQuote('a', 2));
    cache.update(cashuQuote('a', 1));
    expect(cache.get('a')?.version).toBe(2);
    cache.update(cashuQuote('a', 3));
    expect(cache.get('a')?.version).toBe(3);
  });

  it('remove deletes by id and getByMintQuoteId finds by mint quote id', () => {
    const queryClient = new QueryClient();
    const cache = new PendingCashuReceiveQuotesCache(queryClient);
    cache.add(cashuQuote('a', 1));
    cache.add(cashuQuote('b', 1));
    expect(cache.getByMintQuoteId('mint-b')?.id).toBe('b');
    cache.remove(cashuQuote('a', 1));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.id).toBe('b');
  });

  it('getByMeltQuoteId matches only CASHU_TOKEN quotes', () => {
    const queryClient = new QueryClient();
    const cache = new PendingCashuReceiveQuotesCache(queryClient);
    cache.add({
      ...cashuQuote('a', 1),
      type: 'CASHU_TOKEN',
      tokenReceiveData: { meltQuoteId: 'melt-1' },
    } as unknown as CashuReceiveQuote);
    cache.add({
      ...cashuQuote('b', 1),
      type: 'LIGHTNING',
    } as unknown as CashuReceiveQuote);
    expect(cache.getByMeltQuoteId('melt-1')?.id).toBe('a');
    expect(cache.getByMeltQuoteId('melt-2')).toBeUndefined();
  });
});

describe('SparkReceiveQuoteCache.updateIfExists (version guard)', () => {
  it('ignores older versions and applies newer ones', () => {
    const queryClient = new QueryClient();
    const cache = new SparkReceiveQuoteCache(queryClient);
    cache.add(sparkQuote('a', 2));
    cache.updateIfExists(sparkQuote('a', 1));
    expect(
      queryClient.getQueryData<SparkReceiveQuote>([
        SparkReceiveQuoteCache.Key,
        'a',
      ])?.version,
    ).toBe(2);
    cache.updateIfExists(sparkQuote('a', 3));
    expect(
      queryClient.getQueryData<SparkReceiveQuote>([
        SparkReceiveQuoteCache.Key,
        'a',
      ])?.version,
    ).toBe(3);
  });
});

describe('PendingSparkReceiveQuotesCache.update (version guard)', () => {
  it('ignores older versions and applies newer ones', () => {
    const queryClient = new QueryClient();
    const cache = new PendingSparkReceiveQuotesCache(queryClient);
    cache.add(sparkQuote('a', 2));
    cache.update(sparkQuote('a', 1));
    expect(cache.get('a')?.version).toBe(2);
    cache.update(sparkQuote('a', 3));
    expect(cache.get('a')?.version).toBe(3);
  });
});

describe('PendingCashuReceiveSwapsCache (keyed by tokenHash)', () => {
  it('update applies only newer versions', () => {
    const queryClient = new QueryClient();
    const cache = new PendingCashuReceiveSwapsCache(queryClient);
    cache.add(swap('h1', 2));
    cache.update(swap('h1', 1));
    expect(cache.get('h1')?.version).toBe(2);
    cache.update(swap('h1', 3));
    expect(cache.get('h1')?.version).toBe(3);
  });

  it('remove deletes by tokenHash', () => {
    const queryClient = new QueryClient();
    const cache = new PendingCashuReceiveSwapsCache(queryClient);
    cache.add(swap('h1', 1));
    cache.add(swap('h2', 1));
    cache.remove(swap('h1', 1));
    expect(cache.get('h1')).toBeUndefined();
    expect(cache.get('h2')?.tokenHash).toBe('h2');
  });
});
