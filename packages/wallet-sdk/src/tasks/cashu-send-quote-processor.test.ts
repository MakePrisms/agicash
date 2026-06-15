import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { MeltQuoteSubscriptionManager } from '@agicash/cashu';
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  MintOperationError,
} from '@cashu/cashu-ts';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { CashuSendQuote } from '../send/cashu-send-quote';
import type { UnresolvedCashuSendQuotesCache } from '../send/cashu-send-quote-cache';
import type { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import { createCashuSendQuoteProcessor } from './cashu-send-quote-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  // A couple of microtask/macrotask turns to let the work-set observer fetch,
  // the tracker subscribe, and the dispatched mutations run.
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const MINT_URL = 'https://mint.example';

const sendQuote = (overrides: Partial<CashuSendQuote> = {}): CashuSendQuote =>
  ({
    id: 'send-quote-1',
    quoteId: 'melt-quote-1',
    accountId: 'account-1',
    state: 'UNPAID',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    proofs: [{ amount: 100 }, { amount: 21 }],
    version: 0,
    ...overrides,
  }) as unknown as CashuSendQuote;

const cashuAccount = (): CashuAccount =>
  ({
    id: 'account-1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: MINT_URL,
    isOnline: true,
    wallet: {
      checkMeltQuoteBolt11: mock(async () => meltQuote(MeltQuoteState.PAID)),
    },
  }) as unknown as CashuAccount;

const meltQuote = (
  state: MeltQuoteState,
  overrides: Partial<MeltQuoteBolt11Response> = {},
): MeltQuoteBolt11Response =>
  ({
    quote: 'melt-quote-1',
    amount: 100,
    state,
    expiry: Math.floor((Date.now() + 60_000) / 1000),
    fee_reserve: 1,
    payment_preimage: 'preimage',
    change: [],
    ...overrides,
  }) as unknown as MeltQuoteBolt11Response;

type Harness = {
  queryClient: QueryClient;
  cacheStore: Map<string, CashuSendQuote>;
  unresolvedCashuSendQuotesCache: UnresolvedCashuSendQuotesCache;
  cacheUpdate: ReturnType<typeof mock>;
  service: {
    [K in keyof CashuSendQuoteService]: ReturnType<typeof mock>;
  };
  account: CashuAccount;
  /** The onUpdate callback the processor's tracker registered for the mint. */
  emit: (m: MeltQuoteBolt11Response) => void;
};

const setup = (
  options: {
    initialQuote?: CashuSendQuote;
    serviceOverrides?: Partial<Record<keyof CashuSendQuoteService, unknown>>;
  } = {},
): {
  processor: ReturnType<typeof createCashuSendQuoteProcessor>;
} & Harness => {
  const queryClient = new QueryClient();
  const initial = options.initialQuote ?? sendQuote();

  const cacheStore = new Map<string, CashuSendQuote>([[initial.id, initial]]);

  const cacheUpdate = mock((quote: CashuSendQuote) => {
    cacheStore.set(quote.id, quote);
  });
  const unresolvedCashuSendQuotesCache = {
    get: (id: string) => cacheStore.get(id),
    getByMeltQuoteId: (meltQuoteId: string) =>
      [...cacheStore.values()].find((q) => q.quoteId === meltQuoteId),
    update: cacheUpdate,
  } as unknown as UnresolvedCashuSendQuotesCache;

  const account = cashuAccount();
  const accountsCache = {
    get: (id: string): Account | null => (id === account.id ? account : null),
    getAll: (): Account[] => [account],
  } as unknown as AccountsCache;

  const service = {
    initiateSend: mock(async () => undefined),
    markSendQuoteAsPending: mock(async (quote: CashuSendQuote) => ({
      ...quote,
      state: 'PENDING',
      version: quote.version + 1,
    })),
    completeSendQuote: mock(async (_a, quote: CashuSendQuote) => quote),
    expireSendQuote: mock(async () => undefined),
    failSendQuote: mock(async (_a, quote: CashuSendQuote) => quote),
    ...options.serviceOverrides,
  } as unknown as Harness['service'];

  let emit: (m: MeltQuoteBolt11Response) => void = () => undefined;
  // Capture the onUpdate the tracker registers rather than open a real socket.
  subscribeSpy.mockImplementation(async ({ onUpdate }) => {
    emit = onUpdate;
    return () => undefined;
  });

  const processor = createCashuSendQuoteProcessor({
    queryClient,
    cashuSendQuoteService: service as unknown as CashuSendQuoteService,
    unresolvedCashuSendQuotesCache,
    accountsCache,
    unresolvedCashuQuotesOptions: () => ({
      queryKey: ['unresolved-cashu-send-quotes'],
      queryFn: async () => [...cacheStore.values()],
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    cacheStore,
    unresolvedCashuSendQuotesCache,
    cacheUpdate,
    service,
    account,
    emit: (m) => emit(m),
  };
};

let subscribeSpy: ReturnType<typeof mock>;
let removeSpy: ReturnType<typeof mock>;
let originalSubscribe: MeltQuoteSubscriptionManager['subscribe'];
let originalRemove: MeltQuoteSubscriptionManager['removeQuoteFromSubscription'];

beforeEach(() => {
  originalSubscribe = MeltQuoteSubscriptionManager.prototype.subscribe;
  originalRemove =
    MeltQuoteSubscriptionManager.prototype.removeQuoteFromSubscription;
  subscribeSpy = mock(async () => () => undefined);
  removeSpy = mock(() => undefined);
  MeltQuoteSubscriptionManager.prototype.subscribe =
    subscribeSpy as unknown as MeltQuoteSubscriptionManager['subscribe'];
  MeltQuoteSubscriptionManager.prototype.removeQuoteFromSubscription =
    removeSpy as unknown as MeltQuoteSubscriptionManager['removeQuoteFromSubscription'];
});

afterEach(() => {
  MeltQuoteSubscriptionManager.prototype.subscribe = originalSubscribe;
  MeltQuoteSubscriptionManager.prototype.removeQuoteFromSubscription =
    originalRemove;
});

describe('createCashuSendQuoteProcessor', () => {
  describe('the leader gate', () => {
    it('does not subscribe the melt tracker while inactive (follower)', async () => {
      setup();
      await settle();
      expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('subscribes the melt tracker once activated (leader)', async () => {
      const { processor } = setup();
      processor.activate();
      await settle();
      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(subscribeSpy.mock.calls[0]?.[0]).toMatchObject({
        mintUrl: MINT_URL,
        quoteIds: ['melt-quote-1'],
      });
    });

    it('stops dispatching transitions after deactivate', async () => {
      const { processor, service, emit } = setup();
      processor.activate();
      await settle();

      processor.deactivate();
      emit(meltQuote(MeltQuoteState.PENDING));
      await settle();

      // The tracker's quotes were cleared on deactivate, so handleMeltQuoteUpdate
      // finds no work item and dispatches nothing.
      expect(service.markSendQuoteAsPending).not.toHaveBeenCalled();
    });
  });

  describe('the transition table', () => {
    it('UNPAID + sendQuote UNPAID -> initiateSend (no cache write)', async () => {
      const { processor, service, cacheUpdate, account, emit } = setup();
      processor.activate();
      await settle();

      const mq = meltQuote(MeltQuoteState.UNPAID);
      emit(mq);
      await settle();

      expect(service.initiateSend).toHaveBeenCalledTimes(1);
      expect(service.initiateSend.mock.calls[0]).toEqual([
        account,
        expect.objectContaining({ id: 'send-quote-1' }),
        mq,
      ]);
      expect(cacheUpdate).not.toHaveBeenCalled();
    });

    it('does NOT re-initiate when the mint flipped melt back to UNPAID after the send already started (guard)', async () => {
      const { processor, service, emit } = setup({
        initialQuote: sendQuote({ state: 'PENDING' }),
      });
      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(service.initiateSend).not.toHaveBeenCalled();
    });

    it('PENDING -> markSendQuoteAsPending and writes the updated quote to the cache', async () => {
      const { processor, service, cacheUpdate, emit } = setup();
      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.PENDING));
      await settle();

      expect(service.markSendQuoteAsPending).toHaveBeenCalledTimes(1);
      expect(cacheUpdate).toHaveBeenCalledTimes(1);
      expect(cacheUpdate.mock.calls[0]?.[0]).toMatchObject({
        id: 'send-quote-1',
        state: 'PENDING',
      });
    });

    it('PAID -> completeSendQuote (no cache write — realtime is the write path)', async () => {
      const { processor, service, cacheUpdate, account, emit } = setup();
      processor.activate();
      await settle();

      const mq = meltQuote(MeltQuoteState.PAID);
      emit(mq);
      await settle();

      expect(service.completeSendQuote).toHaveBeenCalledTimes(1);
      expect(service.completeSendQuote.mock.calls[0]).toEqual([
        account,
        expect.objectContaining({ id: 'send-quote-1' }),
        mq,
      ]);
      expect(cacheUpdate).not.toHaveBeenCalled();
    });

    it('UNPAID past expiry (expiry timer) -> expireSendQuote (no cache write)', async () => {
      // Seed an already-expired quote; the tracker arms an expiry timer that
      // fires immediately (msUntilExpiration < 0), checks the melt quote, and —
      // since it is still UNPAID and past expiry — drives onExpired.
      const initialQuote = sendQuote({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const { processor, service, cacheUpdate, account } = setup({
        initialQuote,
      });
      (
        account.wallet.checkMeltQuoteBolt11 as ReturnType<typeof mock>
      ).mockResolvedValue(meltQuote(MeltQuoteState.UNPAID));

      processor.activate();
      await settle();

      expect(service.expireSendQuote).toHaveBeenCalledTimes(1);
      expect(service.expireSendQuote.mock.calls[0]?.[0]).toMatchObject({
        id: 'send-quote-1',
      });
      expect(cacheUpdate).not.toHaveBeenCalled();
    });

    it('a socket UNPAID past the work item expiry does NOT expire (only the timer path does)', async () => {
      // Faithful to handleMeltQuoteUpdate: a socket-delivered UNPAID with
      // handleExpiry=false never calls onExpired even if the work item is past
      // its expiry — the expiry timer is the sole expire trigger.
      const { processor, service, emit } = setup({
        initialQuote: sendQuote({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      });
      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(service.expireSendQuote).not.toHaveBeenCalled();
      expect(service.initiateSend).not.toHaveBeenCalled();
    });

    it('MintOperationError on initiate -> failSendQuote cascade + drops the quote from the subscription', async () => {
      const { processor, service, account, emit } = setup({
        serviceOverrides: {
          initiateSend: mock(async () => {
            throw new MintOperationError(20001, 'mint rejected');
          }),
        },
      });
      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(service.failSendQuote).toHaveBeenCalledTimes(1);
      expect(service.failSendQuote.mock.calls[0]).toEqual([
        account,
        expect.objectContaining({ id: 'send-quote-1' }),
        'mint rejected',
      ]);
      // fail.onSuccess drops the quote so a re-send re-subscribes.
      expect(removeSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy.mock.calls[0]?.[0]).toEqual({
        mintUrl: MINT_URL,
        quoteId: 'melt-quote-1',
      });
    });
  });

  describe('scope serialization', () => {
    it('dispatches initiate under a DISTINCT scope from the per-quote transitions', async () => {
      const { processor, queryClient, emit } = setup();
      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.UNPAID));
      emit(meltQuote(MeltQuoteState.PENDING));
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);

      expect(scopeIds).toContain('initiate-cashu-send-quote-send-quote-1');
      expect(scopeIds).toContain('cashu-send-quote-send-quote-1');
    });
  });

  describe('the updated-in-the-meantime guard', () => {
    it('early-returns from a transition when the entity is gone from the cache', async () => {
      const { processor, service, cacheStore, emit } = setup();
      processor.activate();
      await settle();

      // The melt update arrives but the quote resolved (removed) in the meantime.
      const stale = meltQuote(MeltQuoteState.PENDING);
      cacheStore.clear();
      emit(stale);
      await settle();

      // getByMeltQuoteId returns nothing, so no transition is even dispatched.
      expect(service.markSendQuoteAsPending).not.toHaveBeenCalled();
    });
  });

  describe('the nutshell #788 PAID-change-recovery quirk', () => {
    it('refetches the melt quote for change when input>amount but change is empty', async () => {
      const { processor, service, account, emit } = setup({
        // inputAmount = 100 + 21 = 121 > amount 100, change empty -> refetch.
        initialQuote: sendQuote(),
      });
      const refetched = meltQuote(MeltQuoteState.PAID, {
        change: [{ amount: 21 } as never],
      });
      (
        account.wallet.checkMeltQuoteBolt11 as ReturnType<typeof mock>
      ).mockResolvedValue(refetched);

      processor.activate();
      await settle();

      emit(meltQuote(MeltQuoteState.PAID, { change: [] }));
      await settle();

      expect(account.wallet.checkMeltQuoteBolt11).toHaveBeenCalledWith(
        'melt-quote-1',
      );
      // completeSendQuote receives the refetched melt quote (with change).
      expect(service.completeSendQuote).toHaveBeenCalledTimes(1);
      expect(service.completeSendQuote.mock.calls[0]?.[2]).toBe(refetched);
    });
  });
});
