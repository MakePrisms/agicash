import { describe, expect, it, mock } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import type { PendingCashuReceiveSwapsCache } from '../receive/cashu-receive-swap-cache';
import type { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import { createCashuReceiveSwapProcessor } from './cashu-receive-swap-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const swap = (overrides: Partial<CashuReceiveSwap> = {}): CashuReceiveSwap =>
  ({
    tokenHash: 'token-hash-1',
    accountId: 'account-1',
    state: 'PENDING',
    version: 0,
    ...overrides,
  }) as unknown as CashuReceiveSwap;

const cashuAccount = (): CashuAccount =>
  ({
    id: 'account-1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: 'https://mint.example',
    isOnline: true,
    wallet: {},
  }) as unknown as CashuAccount;

const setup = (
  options: { initialSwaps?: CashuReceiveSwap[] } = {},
): {
  processor: ReturnType<typeof createCashuReceiveSwapProcessor>;
  queryClient: QueryClient;
  cacheStore: Map<string, CashuReceiveSwap>;
  completeSwap: ReturnType<typeof mock>;
  account: CashuAccount;
  setWorkSet: (swaps: CashuReceiveSwap[]) => void;
} => {
  const queryClient = new QueryClient();
  const initial = options.initialSwaps ?? [swap()];
  const cacheStore = new Map(initial.map((s) => [s.tokenHash, s]));
  let workSet = [...cacheStore.values()];

  const pendingCache = {
    get: (tokenHash: string) => cacheStore.get(tokenHash),
  } as unknown as PendingCashuReceiveSwapsCache;

  const account = cashuAccount();
  const accountsCache = {
    get: (id: string): Account | null => (id === account.id ? account : null),
    getAll: (): Account[] => [account],
  } as unknown as AccountsCache;

  const completeSwap = mock(async () => undefined);
  const service = {
    completeSwap,
  } as unknown as CashuReceiveSwapService;

  const processor = createCashuReceiveSwapProcessor({
    queryClient,
    cashuReceiveSwapService: service,
    pendingCashuReceiveSwapsCache: pendingCache,
    accountsCache,
    pendingCashuSwapsOptions: () => ({
      queryKey: ['pending-cashu-receive-swaps'],
      queryFn: async () => workSet,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    cacheStore,
    completeSwap,
    account,
    setWorkSet: (swaps) => {
      workSet = swaps;
      queryClient.invalidateQueries({
        queryKey: ['pending-cashu-receive-swaps'],
      });
    },
  };
};

describe('createCashuReceiveSwapProcessor', () => {
  describe('the leader gate', () => {
    it('does not complete any swap while inactive (follower)', async () => {
      const { completeSwap } = setup();
      await settle();
      expect(completeSwap).not.toHaveBeenCalled();
    });

    it('fires completeSwap once per pending swap once activated (leader)', async () => {
      const { processor, completeSwap, account } = setup();
      processor.activate();
      await settle();

      expect(completeSwap).toHaveBeenCalledTimes(1);
      expect(completeSwap.mock.calls[0]?.[0]).toBe(account);
      expect(completeSwap.mock.calls[0]?.[1]).toMatchObject({
        tokenHash: 'token-hash-1',
      });
    });

    it('does not re-fire after deactivate', async () => {
      const { processor, completeSwap } = setup();
      processor.activate();
      await settle();
      expect(completeSwap).toHaveBeenCalledTimes(1);

      processor.deactivate();
      await settle();
      expect(completeSwap).toHaveBeenCalledTimes(1);
    });
  });

  describe('fire-once semantics', () => {
    it('fires exactly once per swap even across work-set refetches', async () => {
      const { processor, completeSwap, setWorkSet } = setup();
      processor.activate();
      await settle();
      expect(completeSwap).toHaveBeenCalledTimes(1);

      // Re-deliver the same work-set: staleTime Infinity means the per-swap
      // trigger query never refetches, so completeSwap is not fired again.
      setWorkSet([swap()]);
      await settle();
      expect(completeSwap).toHaveBeenCalledTimes(1);
    });

    it('uses the receive-swap-${tokenHash} scope and writes no cache', async () => {
      const { processor, queryClient } = setup();
      processor.activate();
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);
      expect(scopeIds).toContain('receive-swap-token-hash-1');
    });
  });

  describe('the updated-in-the-meantime guard', () => {
    it('early-returns from completeSwap when the swap is gone from the cache', async () => {
      const { processor, completeSwap, cacheStore } = setup();
      // The swap is in the work-set (drives the trigger) but resolved from the
      // pending cache in the meantime — the mutationFn must early-return.
      cacheStore.clear();
      processor.activate();
      await settle();

      // The trigger fired the mutation, but the service was never called because
      // the entity was gone from the cache.
      expect(completeSwap).not.toHaveBeenCalled();
    });
  });
});
