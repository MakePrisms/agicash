import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { MintValidator } from '@agicash/cashu';
import type { AgicashDb } from '@agicash/db-types';
import { QueryClient } from '@tanstack/query-core';
import type { AccountRepository } from '../accounts/account-repository';
import type { AccountService } from '../accounts/account-service';
import type { Encryption } from '../encryption';
import type { UserService } from '../user/user-service';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { type ReceiveApi, createReceiveApi } from './receive-api';

const makeApi = (): ReceiveApi =>
  createReceiveApi({
    queryClient: new QueryClient(),
    db: {} as AgicashDb,
    encryption: {} as Encryption,
    getCurrentUserId: () => {
      throw new Error('not expected to be called');
    },
    getCurrentUser: () => {
      throw new Error('not expected to be called');
    },
    accountRepository: {} as AccountRepository,
    accountService: {} as AccountService,
    userService: {} as UserService,
    cashuMintValidator: {} as MintValidator,
  }).api;

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe('receive-api quoteByTransactionIdOptions', () => {
  it('keys on the transaction id and delegates the queryFn to the repository', async () => {
    const quote = { id: 'q1' } as unknown as CashuReceiveQuote;
    const get = spyOn(
      CashuReceiveQuoteRepository.prototype,
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
      CashuReceiveQuoteRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(null);
    restores.push(() => get.mockRestore());

    const options = makeApi().quoteByTransactionIdOptions('tx-missing');

    expect(await options.queryFn()).toBeNull();
  });
});

describe('receive-api swapByTransactionIdOptions', () => {
  it('keys on the transaction id and delegates the queryFn to the repository', async () => {
    const swap = { id: 's1' } as unknown as CashuReceiveSwap;
    const get = spyOn(
      CashuReceiveSwapRepository.prototype,
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
      CashuReceiveSwapRepository.prototype,
      'getByTransactionId',
    ).mockResolvedValue(null);
    restores.push(() => get.mockRestore());

    const options = makeApi().swapByTransactionIdOptions('tx-missing');

    expect(await options.queryFn()).toBeNull();
  });
});
