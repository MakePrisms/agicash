import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { AgicashDb } from '@agicash/db-types';
import { QueryClient } from '@tanstack/query-core';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { Encryption } from '../encryption';
import type { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import type { CashuSendQuote } from './cashu-send-quote';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { CashuSendSwap } from './cashu-send-swap';
import { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { type SendApi, createSendApi } from './send-api';

const makeApi = (): SendApi =>
  createSendApi({
    queryClient: new QueryClient(),
    db: {} as AgicashDb,
    encryption: {} as Encryption,
    getCurrentUserId: () => {
      throw new Error('not expected to be called');
    },
    accountsCache: {} as AccountsCache,
    cashuReceiveSwapService: {} as CashuReceiveSwapService,
  }).api;

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe('send-api quoteByTransactionIdOptions', () => {
  it('keys on the transaction id and delegates the queryFn to the repository', async () => {
    const quote = { id: 'q1' } as unknown as CashuSendQuote;
    const get = spyOn(
      CashuSendQuoteRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(quote);
    restores.push(() => get.mockRestore());

    const options = makeApi().quoteByTransactionIdOptions('tx-1');

    expect(options.queryKey).toEqual(['transaction-details', 'tx-1']);
    expect(await options.queryFn()).toBe(quote);
    expect(get).toHaveBeenCalledWith('tx-1');
  });

  it('resolves null when the repository has no quote for the transaction', async () => {
    const get = spyOn(
      CashuSendQuoteRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(null);
    restores.push(() => get.mockRestore());

    const options = makeApi().quoteByTransactionIdOptions('tx-missing');

    expect(await options.queryFn()).toBeNull();
  });
});

describe('send-api swapByTransactionIdOptions', () => {
  it('keys on the transaction id and delegates the queryFn to the repository', async () => {
    const swap = { id: 's1' } as unknown as CashuSendSwap;
    const get = spyOn(
      CashuSendSwapRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(swap);
    restores.push(() => get.mockRestore());

    const options = makeApi().swapByTransactionIdOptions('tx-2');

    expect(options.queryKey).toEqual(['transaction-details', 'tx-2']);
    expect(await options.queryFn()).toBe(swap);
    expect(get).toHaveBeenCalledWith('tx-2');
  });

  it('resolves null when the repository has no swap for the transaction', async () => {
    const get = spyOn(
      CashuSendSwapRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(null);
    restores.push(() => get.mockRestore());

    const options = makeApi().swapByTransactionIdOptions('tx-missing');

    expect(await options.queryFn()).toBeNull();
  });
});
