import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from '../send/cashu-send-swap';
import type { CashuSendSwapCache } from '../send/cashu-send-swap-cache';
import type { CashuSendSwapService } from '../send/cashu-send-swap-service';
import { ProofStateSubscriptionManager } from '../send/proof-state-subscription-manager';
import { createCashuSendSwapProcessor } from './cashu-send-swap-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const MINT_URL = 'https://mint.example';

const draftSwap = (overrides: Partial<CashuSendSwap> = {}): CashuSendSwap =>
  ({
    id: 'send-swap-1',
    accountId: 'account-1',
    state: 'DRAFT',
    version: 0,
    ...overrides,
  }) as unknown as CashuSendSwap;

const pendingSwap = (
  overrides: Partial<PendingCashuSendSwap> = {},
): PendingCashuSendSwap =>
  ({
    id: 'send-swap-1',
    accountId: 'account-1',
    state: 'PENDING',
    tokenHash: 'token-hash-1',
    proofsToSend: [{ unblindedSignature: 'C-1' }],
    version: 0,
    ...overrides,
  }) as unknown as PendingCashuSendSwap;

const cashuAccount = (): CashuAccount =>
  ({
    id: 'account-1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: MINT_URL,
    isOnline: true,
    wallet: {},
  }) as unknown as CashuAccount;

type ProofStateSubscribeArgs = Parameters<
  ProofStateSubscriptionManager['subscribe']
>[0];

type Harness = {
  queryClient: QueryClient;
  draftStore: CashuSendSwap[];
  pendingStore: CashuSendSwap[];
  swapForProofsToSend: ReturnType<typeof mock>;
  complete: ReturnType<typeof mock>;
  invalidate: ReturnType<typeof mock>;
  account: CashuAccount;
  setWorkSet: (swaps: CashuSendSwap[]) => void;
  /** The captured per-mint onSpent callbacks, keyed by mint url. */
  spentCallbacks: Map<string, (swap: CashuSendSwap) => void>;
};

const setup = (
  options: {
    initialSwaps?: CashuSendSwap[];
    serviceOverrides?: Partial<Record<keyof CashuSendSwapService, unknown>>;
  } = {},
): {
  processor: ReturnType<typeof createCashuSendSwapProcessor>;
} & Harness => {
  const queryClient = new QueryClient();
  let workSet = options.initialSwaps ?? [draftSwap()];

  const account = cashuAccount();
  const accountsCache = {
    get: (id: string): Account | null => (id === account.id ? account : null),
    getAll: (): Account[] => [account],
  } as unknown as AccountsCache;

  const swapForProofsToSend = mock(async () => undefined);
  const complete = mock(async () => undefined);
  const service = {
    swapForProofsToSend,
    complete,
    ...options.serviceOverrides,
  } as unknown as CashuSendSwapService;

  const invalidate = mock(() => undefined);
  const cashuSendSwapCache = {
    invalidate,
  } as unknown as CashuSendSwapCache;

  const processor = createCashuSendSwapProcessor({
    queryClient,
    cashuSendSwapService: service,
    cashuSendSwapCache,
    accountsCache,
    unresolvedCashuSwapsOptions: () => ({
      queryKey: ['unresolved-cashu-send-swaps'],
      queryFn: async () => workSet,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    get draftStore() {
      return workSet.filter((s) => s.state === 'DRAFT');
    },
    get pendingStore() {
      return workSet.filter((s) => s.state === 'PENDING');
    },
    swapForProofsToSend,
    complete,
    invalidate,
    account,
    setWorkSet: (swaps) => {
      workSet = swaps;
      queryClient.invalidateQueries({
        queryKey: ['unresolved-cashu-send-swaps'],
      });
    },
    spentCallbacks,
  };
};

let subscribeSpy: ReturnType<typeof mock>;
let originalSubscribe: ProofStateSubscriptionManager['subscribe'];
let spentCallbacks: Map<string, (swap: CashuSendSwap) => void>;

beforeEach(() => {
  spentCallbacks = new Map();
  originalSubscribe = ProofStateSubscriptionManager.prototype.subscribe;
  subscribeSpy = mock(async ({ mintUrl, onSpent }: ProofStateSubscribeArgs) => {
    spentCallbacks.set(mintUrl, onSpent);
    return () => undefined;
  });
  ProofStateSubscriptionManager.prototype.subscribe =
    subscribeSpy as unknown as ProofStateSubscriptionManager['subscribe'];
});

afterEach(() => {
  ProofStateSubscriptionManager.prototype.subscribe = originalSubscribe;
});

describe('createCashuSendSwapProcessor', () => {
  describe('the leader gate', () => {
    it('does nothing while inactive (follower)', async () => {
      const { swapForProofsToSend } = setup();
      await settle();
      expect(swapForProofsToSend).not.toHaveBeenCalled();
      expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('fires swapForProofsToSend once per DRAFT swap once activated (leader)', async () => {
      const { processor, swapForProofsToSend, account } = setup();
      processor.activate();
      await settle();

      expect(swapForProofsToSend).toHaveBeenCalledTimes(1);
      expect(swapForProofsToSend.mock.calls[0]?.[0]).toMatchObject({
        swap: expect.objectContaining({ id: 'send-swap-1' }),
        account,
      });
    });

    it('subscribes the proof-state tracker for a PENDING swap once activated (leader)', async () => {
      const { processor } = setup({ initialSwaps: [pendingSwap()] });
      processor.activate();
      await settle();

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(subscribeSpy.mock.calls[0]?.[0]).toMatchObject({
        mintUrl: MINT_URL,
      });
    });

    it('does not re-fire the DRAFT trigger after deactivate', async () => {
      const { processor, swapForProofsToSend } = setup();
      processor.activate();
      await settle();
      expect(swapForProofsToSend).toHaveBeenCalledTimes(1);

      processor.deactivate();
      await settle();
      expect(swapForProofsToSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('the DRAFT driver (fire-once swapForProofsToSend)', () => {
    it('fires exactly once per swap even across work-set refetches', async () => {
      const { processor, swapForProofsToSend, setWorkSet } = setup();
      processor.activate();
      await settle();
      expect(swapForProofsToSend).toHaveBeenCalledTimes(1);

      // Re-deliver the same work-set: staleTime Infinity means the per-swap
      // trigger query never refetches, so swapForProofsToSend is not re-fired.
      setWorkSet([draftSwap()]);
      await settle();
      expect(swapForProofsToSend).toHaveBeenCalledTimes(1);
    });

    it('uses the send-swap-${id} scope and writes no cache', async () => {
      const { processor, queryClient, invalidate } = setup();
      processor.activate();
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);
      expect(scopeIds).toContain('send-swap-send-swap-1');
      // The DRAFT driver writes no cache.
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('does not fire for a DRAFT swap on an offline account (the online-select filter)', async () => {
      // The DRAFT swap belongs to an offline account: selectOnline filters it out
      // of the work-set, so no trigger is created and the service is never called.
      const queryClient = new QueryClient();
      const offlineAccount = {
        id: 'account-1',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: MINT_URL,
        isOnline: false,
        wallet: {},
      } as unknown as CashuAccount;
      const swapForProofsToSend = mock(async () => undefined);
      const processor = createCashuSendSwapProcessor({
        queryClient,
        cashuSendSwapService: {
          swapForProofsToSend,
          complete: mock(async () => undefined),
        } as unknown as CashuSendSwapService,
        cashuSendSwapCache: {
          invalidate: mock(() => undefined),
        } as unknown as CashuSendSwapCache,
        accountsCache: {
          get: (id: string): Account | null =>
            id === offlineAccount.id ? offlineAccount : null,
          getAll: (): Account[] => [offlineAccount],
        } as unknown as AccountsCache,
        unresolvedCashuSwapsOptions: () => ({
          queryKey: ['unresolved-cashu-send-swaps'],
          queryFn: async () => [draftSwap()],
          staleTime: Number.POSITIVE_INFINITY,
        }),
      });
      processor.activate();
      await settle();

      expect(swapForProofsToSend).not.toHaveBeenCalled();
    });
  });

  describe('the PENDING driver (proof onSpent -> complete + invalidate)', () => {
    it('completes the swap and invalidates the full cache (not granular) when all proofs are spent', async () => {
      const { processor, complete, invalidate } = setup({
        initialSwaps: [pendingSwap()],
      });
      processor.activate();
      await settle();

      // The subscription manager (here spied) aggregates the "all spent"
      // condition and fires onSpent with the swap.
      const onSpent = spentCallbacks.get(MINT_URL);
      expect(onSpent).toBeDefined();
      onSpent?.(pendingSwap());
      await settle();

      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0]?.[0]).toMatchObject({ id: 'send-swap-1' });
      // onSuccess performs a full refetch via invalidate, NOT a granular write.
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('uses the send-swap-${id} scope for complete', async () => {
      const { processor, queryClient } = setup({
        initialSwaps: [pendingSwap()],
      });
      processor.activate();
      await settle();

      spentCallbacks.get(MINT_URL)?.(pendingSwap());
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);
      expect(scopeIds).toContain('send-swap-send-swap-1');
    });

    it('early-returns from complete when the pending swap is gone from the work-set', async () => {
      const { processor, complete, setWorkSet } = setup({
        initialSwaps: [pendingSwap()],
      });
      processor.activate();
      await settle();

      const onSpent = spentCallbacks.get(MINT_URL);
      // The swap leaves the pending partition before onSpent fires.
      setWorkSet([]);
      await settle();
      onSpent?.(pendingSwap());
      await settle();

      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('the proof-state tracker wiring (drives the all-spent aggregation)', () => {
    it('passes the full multi-proof swap and an onSpent callback to the manager so it can aggregate "all spent"', async () => {
      // The manager owns the multi-proof "all spent" aggregation; the processor's
      // job is to hand it the complete swap (with all proofsToSend) and an
      // onSpent that dispatches complete. Assert that wiring, then drive the
      // onSpent the manager would fire only once every proof is SPENT.
      const swap = pendingSwap({
        proofsToSend: [
          { unblindedSignature: 'C-1' },
          { unblindedSignature: 'C-2' },
        ],
      } as unknown as Partial<PendingCashuSendSwap>);
      const { processor, complete } = setup({ initialSwaps: [swap] });
      processor.activate();
      await settle();

      const args = subscribeSpy.mock.calls[0]?.[0] as ProofStateSubscribeArgs;
      expect(args.mintUrl).toBe(MINT_URL);
      // The whole swap (both proofs) is handed to the manager for aggregation.
      expect(args.swaps[0]?.proofsToSend).toHaveLength(2);

      // The manager fires onSpent ONLY on all-spent; simulate that single fire.
      spentCallbacks.get(MINT_URL)?.(swap);
      await settle();
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('groups swaps from different mints into separate subscriptions', async () => {
      const otherAccount = {
        id: 'account-2',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: 'https://other-mint.example',
        isOnline: true,
        wallet: {},
      } as unknown as CashuAccount;

      const queryClient = new QueryClient();
      const swaps = [
        pendingSwap({ id: 'swap-a', accountId: 'account-1' }),
        pendingSwap({ id: 'swap-b', accountId: 'account-2' }),
      ];
      const accountsCache = {
        get: (id: string): Account | null =>
          id === 'account-1'
            ? cashuAccount()
            : id === 'account-2'
              ? otherAccount
              : null,
        getAll: (): Account[] => [cashuAccount(), otherAccount],
      } as unknown as AccountsCache;

      const processor = createCashuSendSwapProcessor({
        queryClient,
        cashuSendSwapService: {
          swapForProofsToSend: mock(async () => undefined),
          complete: mock(async () => undefined),
        } as unknown as CashuSendSwapService,
        cashuSendSwapCache: {
          invalidate: mock(() => undefined),
        } as unknown as CashuSendSwapCache,
        accountsCache,
        unresolvedCashuSwapsOptions: () => ({
          queryKey: ['unresolved-cashu-send-swaps'],
          queryFn: async () => swaps,
          staleTime: Number.POSITIVE_INFINITY,
        }),
      });
      processor.activate();
      await settle();

      const subscribedMints = subscribeSpy.mock.calls.map(
        (c) => (c[0] as ProofStateSubscribeArgs).mintUrl,
      );
      expect(subscribedMints).toContain(MINT_URL);
      expect(subscribedMints).toContain('https://other-mint.example');
    });
  });
});
