import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  MeltQuoteSubscriptionManager,
  MintQuoteSubscriptionManager,
} from '@agicash/cashu';
import { Money } from '@agicash/utils/money';
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  MintOperationError,
  type MintQuoteBolt11Response,
} from '@cashu/cashu-ts';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from '../receive/cashu-receive-quote-cache';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { createCashuReceiveQuoteProcessor } from './cashu-receive-quote-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const MINT_URL = 'https://mint.example';
const SOURCE_MINT_URL = 'https://source-mint.example';

const lightningQuote = (
  overrides: Partial<CashuReceiveQuote> = {},
): CashuReceiveQuote =>
  ({
    id: 'receive-quote-1',
    quoteId: 'mint-quote-1',
    accountId: 'account-1',
    transactionId: 'tx-1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    version: 0,
    ...overrides,
  }) as unknown as CashuReceiveQuote;

const tokenQuote = (
  overrides: Partial<CashuReceiveQuote> = {},
  meltInitiated = false,
): CashuReceiveQuote =>
  ({
    id: 'receive-quote-token-1',
    quoteId: 'mint-quote-token-1',
    accountId: 'account-1',
    transactionId: 'tx-token-1',
    type: 'CASHU_TOKEN',
    state: 'UNPAID',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    version: 0,
    tokenReceiveData: {
      sourceMintUrl: SOURCE_MINT_URL,
      meltQuoteId: 'melt-quote-1',
      meltInitiated,
      tokenAmount: new Money({ amount: 121, currency: 'BTC', unit: 'sat' }),
      tokenProofs: [{ amount: 100 }, { amount: 21 }],
    },
    ...overrides,
  }) as unknown as CashuReceiveQuote;

const mintQuote = (
  state: 'UNPAID' | 'PAID' | 'ISSUED',
  quote = 'mint-quote-1',
): MintQuoteBolt11Response =>
  ({
    quote,
    state,
    request: 'lnbc...',
    unit: 'sat',
  }) as unknown as MintQuoteBolt11Response;

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
    change: [],
    ...overrides,
  }) as unknown as MeltQuoteBolt11Response;

/** Mint info reporting NUT-17 bolt11_mint_quote WS support (or not). */
const mintInfo = (supportsMintQuoteWs: boolean) => ({
  isSupported: (_nut: number) => ({
    supported: supportsMintQuoteWs,
    params: supportsMintQuoteWs
      ? [{ method: 'bolt11', unit: 'sat', commands: ['bolt11_mint_quote'] }]
      : [],
  }),
});

const cashuAccount = (supportsMintQuoteWs = true): CashuAccount =>
  ({
    id: 'account-1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: MINT_URL,
    isOnline: true,
    wallet: {
      getMintInfo: () => mintInfo(supportsMintQuoteWs),
      checkMintQuoteBolt11: mock(async () => mintQuote('UNPAID')),
      checkMeltQuoteBolt11: mock(async () => meltQuote(MeltQuoteState.PAID)),
    },
  }) as unknown as CashuAccount;

type Harness = {
  queryClient: QueryClient;
  cacheStore: Map<string, CashuReceiveQuote>;
  pendingCache: PendingCashuReceiveQuotesCache;
  cacheUpdate: ReturnType<typeof mock>;
  quoteCacheUpdateIfExists: ReturnType<typeof mock>;
  invalidateTransaction: ReturnType<typeof mock>;
  service: { [K in keyof CashuReceiveQuoteService]: ReturnType<typeof mock> };
  account: CashuAccount;
  /** Pushes a mint-quote update through the registered WS onUpdate. */
  emitMint: (m: MintQuoteBolt11Response) => void;
  /** Pushes a melt-quote update through the registered WS onUpdate. */
  emitMelt: (m: MeltQuoteBolt11Response) => void;
};

const setup = (
  options: {
    initialQuotes?: CashuReceiveQuote[];
    serviceOverrides?: Partial<Record<keyof CashuReceiveQuoteService, unknown>>;
    supportsMintQuoteWs?: boolean;
  } = {},
): {
  processor: ReturnType<typeof createCashuReceiveQuoteProcessor>;
} & Harness => {
  const queryClient = new QueryClient();
  const initial = options.initialQuotes ?? [lightningQuote()];
  const cacheStore = new Map(initial.map((q) => [q.id, q]));

  const cacheUpdate = mock((quote: CashuReceiveQuote) => {
    cacheStore.set(quote.id, quote);
  });
  const pendingCache = {
    get: (id: string) => cacheStore.get(id),
    update: cacheUpdate,
    getByMintQuoteId: (mintQuoteId: string) =>
      [...cacheStore.values()].find((q) => q.quoteId === mintQuoteId),
    getByMeltQuoteId: (meltQuoteId: string) =>
      [...cacheStore.values()].find(
        (q) =>
          q.type === 'CASHU_TOKEN' &&
          q.tokenReceiveData.meltQuoteId === meltQuoteId,
      ),
  } as unknown as PendingCashuReceiveQuotesCache;

  const quoteCacheUpdateIfExists = mock(() => undefined);
  const cashuReceiveQuoteCache = {
    updateIfExists: quoteCacheUpdateIfExists,
  } as unknown as CashuReceiveQuoteCache;

  const account = cashuAccount(options.supportsMintQuoteWs ?? true);
  const accountsCache = {
    get: (id: string): Account | null => (id === account.id ? account : null),
    getAll: (): Account[] => [account],
  } as unknown as AccountsCache;

  const invalidateTransaction = mock(async () => undefined);

  const service = {
    completeReceive: mock(async (account: CashuAccount, quote) => ({
      quote: { ...quote, state: 'COMPLETED', version: quote.version + 1 },
      account,
      addedProofs: [],
    })),
    expire: mock(async () => undefined),
    fail: mock(async () => undefined),
    markMeltInitiated: mock(async (quote) => quote),
    ...options.serviceOverrides,
  } as unknown as Harness['service'];

  let emitMint: (m: MintQuoteBolt11Response) => void = () => undefined;
  mintSubscribeSpy.mockImplementation(async ({ onUpdate }) => {
    emitMint = onUpdate;
    return () => undefined;
  });
  let emitMelt: (m: MeltQuoteBolt11Response) => void = () => undefined;
  meltSubscribeSpy.mockImplementation(async ({ onUpdate }) => {
    emitMelt = onUpdate;
    return () => undefined;
  });

  const processor = createCashuReceiveQuoteProcessor({
    queryClient,
    cashuReceiveQuoteService: service as unknown as CashuReceiveQuoteService,
    cashuReceiveQuoteCache,
    pendingCashuReceiveQuotesCache: pendingCache,
    accountsCache,
    invalidateTransaction,
    pendingCashuQuotesOptions: () => ({
      queryKey: ['pending-cashu-receive-quotes'],
      queryFn: async () => [...cacheStore.values()],
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    cacheStore,
    pendingCache,
    cacheUpdate,
    quoteCacheUpdateIfExists,
    invalidateTransaction,
    service,
    account,
    emitMint: (m) => emitMint(m),
    emitMelt: (m) => emitMelt(m),
  };
};

let mintSubscribeSpy: ReturnType<typeof mock>;
let meltSubscribeSpy: ReturnType<typeof mock>;
let mintUnsubscribeAllSpy: ReturnType<typeof mock>;
let meltUnsubscribeAllSpy: ReturnType<typeof mock>;
let originalMintSubscribe: MintQuoteSubscriptionManager['subscribe'];
let originalMeltSubscribe: MeltQuoteSubscriptionManager['subscribe'];
let originalMintUnsubscribeAll: MintQuoteSubscriptionManager['unsubscribeAll'];
let originalMeltUnsubscribeAll: MeltQuoteSubscriptionManager['unsubscribeAll'];

beforeEach(() => {
  originalMintSubscribe = MintQuoteSubscriptionManager.prototype.subscribe;
  originalMeltSubscribe = MeltQuoteSubscriptionManager.prototype.subscribe;
  mintSubscribeSpy = mock(async () => () => undefined);
  meltSubscribeSpy = mock(async () => () => undefined);
  MintQuoteSubscriptionManager.prototype.subscribe =
    mintSubscribeSpy as unknown as MintQuoteSubscriptionManager['subscribe'];
  MeltQuoteSubscriptionManager.prototype.subscribe =
    meltSubscribeSpy as unknown as MeltQuoteSubscriptionManager['subscribe'];

  originalMintUnsubscribeAll =
    MintQuoteSubscriptionManager.prototype.unsubscribeAll;
  originalMeltUnsubscribeAll =
    MeltQuoteSubscriptionManager.prototype.unsubscribeAll;
  mintUnsubscribeAllSpy = mock(() => undefined);
  meltUnsubscribeAllSpy = mock(() => undefined);
  MintQuoteSubscriptionManager.prototype.unsubscribeAll =
    mintUnsubscribeAllSpy as unknown as MintQuoteSubscriptionManager['unsubscribeAll'];
  MeltQuoteSubscriptionManager.prototype.unsubscribeAll =
    meltUnsubscribeAllSpy as unknown as MeltQuoteSubscriptionManager['unsubscribeAll'];
});

afterEach(() => {
  MintQuoteSubscriptionManager.prototype.subscribe = originalMintSubscribe;
  MeltQuoteSubscriptionManager.prototype.subscribe = originalMeltSubscribe;
  MintQuoteSubscriptionManager.prototype.unsubscribeAll =
    originalMintUnsubscribeAll;
  MeltQuoteSubscriptionManager.prototype.unsubscribeAll =
    originalMeltUnsubscribeAll;
});

describe('createCashuReceiveQuoteProcessor', () => {
  describe('the leader gate', () => {
    it('does not subscribe the mint tracker while inactive (follower)', async () => {
      setup();
      await settle();
      expect(mintSubscribeSpy).not.toHaveBeenCalled();
    });

    it('subscribes the mint tracker once activated (leader)', async () => {
      const { processor } = setup();
      processor.activate();
      await settle();
      expect(mintSubscribeSpy).toHaveBeenCalledTimes(1);
      expect(mintSubscribeSpy.mock.calls[0]?.[0]).toMatchObject({
        mintUrl: MINT_URL,
        quoteIds: ['mint-quote-1'],
      });
    });

    it('stops dispatching transitions after deactivate', async () => {
      const { processor, service, emitMint } = setup();
      processor.activate();
      await settle();

      processor.deactivate();
      emitMint(mintQuote('PAID'));
      await settle();

      // resolveQuote returns nothing once the work-set cleared, so nothing fires.
      expect(service.completeReceive).not.toHaveBeenCalled();
    });

    it('unsubscribes the mint and melt sockets on deactivate', async () => {
      const { processor } = setup();
      processor.activate();
      await settle();

      processor.deactivate();

      expect(mintUnsubscribeAllSpy).toHaveBeenCalledTimes(1);
      expect(meltUnsubscribeAllSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('the mint-quote partition (WS vs poll)', () => {
    it('subscribes a socket when the mint supports NUT-17 bolt11_mint_quote', async () => {
      const { processor, account } = setup({ supportsMintQuoteWs: true });
      processor.activate();
      await settle();
      expect(mintSubscribeSpy).toHaveBeenCalledTimes(1);
      // No initial poll fetch for a WS-tracked quote.
      expect(account.wallet.checkMintQuoteBolt11).not.toHaveBeenCalled();
    });

    it('polls (no socket) when the mint does not support mint-quote WS', async () => {
      const { processor, account } = setup({ supportsMintQuoteWs: false });
      processor.activate();
      await settle();
      expect(mintSubscribeSpy).not.toHaveBeenCalled();
      // The poll observer fetches the quote at least once.
      expect(account.wallet.checkMintQuoteBolt11).toHaveBeenCalledWith(
        'mint-quote-1',
      );
    });
  });

  describe('the mint-quote transition table', () => {
    it('PAID -> completeReceive + invalidates tx + writes both caches', async () => {
      const {
        processor,
        service,
        invalidateTransaction,
        cacheUpdate,
        quoteCacheUpdateIfExists,
        account,
        emitMint,
      } = setup();
      processor.activate();
      await settle();

      emitMint(mintQuote('PAID'));
      await settle();

      expect(service.completeReceive).toHaveBeenCalledTimes(1);
      expect(service.completeReceive.mock.calls[0]?.[0]).toBe(account);
      expect(invalidateTransaction).toHaveBeenCalledWith('tx-1');
      expect(quoteCacheUpdateIfExists).toHaveBeenCalledTimes(1);
      expect(cacheUpdate).toHaveBeenCalledTimes(1);
    });

    it('ISSUED -> completeReceive (recovery path)', async () => {
      const { processor, service, emitMint } = setup();
      processor.activate();
      await settle();

      emitMint(mintQuote('ISSUED'));
      await settle();

      expect(service.completeReceive).toHaveBeenCalledTimes(1);
    });

    it('UNPAID past expiry (expiry timer) -> expire (no cache write)', async () => {
      // Seed an already-expired UNPAID quote; the WS quote arms an expiry timer
      // that fires immediately (msUntilExpiration < 0), re-fetches the mint
      // quote (still UNPAID), and — since it is past expiry — drives onExpired.
      const { processor, service, cacheUpdate, account } = setup({
        initialQuotes: [
          lightningQuote({
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        ],
      });
      (
        account.wallet.checkMintQuoteBolt11 as ReturnType<typeof mock>
      ).mockResolvedValue(mintQuote('UNPAID'));

      processor.activate();
      await settle();

      expect(service.expire).toHaveBeenCalledTimes(1);
      expect(service.completeReceive).not.toHaveBeenCalled();
      expect(cacheUpdate).not.toHaveBeenCalled();
    });

    it('UNPAID not-yet-expired (socket) -> no transition', async () => {
      const { processor, service, emitMint } = setup();
      processor.activate();
      await settle();

      emitMint(mintQuote('UNPAID'));
      await settle();

      expect(service.expire).not.toHaveBeenCalled();
      expect(service.completeReceive).not.toHaveBeenCalled();
    });
  });

  describe('the melt leg', () => {
    it('subscribes the melt tracker for a CASHU_TOKEN quote', async () => {
      const { processor } = setup({ initialQuotes: [tokenQuote()] });
      processor.activate();
      await settle();
      expect(meltSubscribeSpy).toHaveBeenCalledTimes(1);
      expect(meltSubscribeSpy.mock.calls[0]?.[0]).toMatchObject({
        mintUrl: SOURCE_MINT_URL,
        quoteIds: ['melt-quote-1'],
      });
    });

    it('melt UNPAID & not-initiated -> initiateMelt with random outputs (§4)', async () => {
      const account = cashuAccount();
      const meltProofsIdempotent = mock(
        async (
          _quote: { quote: string; amount: number },
          _proofs: unknown,
          _counter: unknown,
          _outputs: { type: string },
        ): Promise<void> => undefined,
      );
      // The source mint is the user's own online account.
      const sourceAccount = {
        id: 'source-account',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: SOURCE_MINT_URL,
        isOnline: true,
        wallet: { meltProofsIdempotent },
      } as unknown as CashuAccount;
      const accountsCache = {
        get: (id: string): Account | null =>
          id === account.id ? account : null,
        getAll: (): Account[] => [account, sourceAccount],
      } as unknown as AccountsCache;

      const cacheStore = new Map<string, CashuReceiveQuote>([
        ['receive-quote-token-1', tokenQuote()],
      ]);
      const pendingCache = {
        get: (id: string) => cacheStore.get(id),
        update: mock(() => undefined),
        getByMintQuoteId: () => undefined,
        getByMeltQuoteId: (meltQuoteId: string) =>
          [...cacheStore.values()].find(
            (q) =>
              q.type === 'CASHU_TOKEN' &&
              q.tokenReceiveData.meltQuoteId === meltQuoteId,
          ),
      } as unknown as PendingCashuReceiveQuotesCache;

      let emitMelt: (m: MeltQuoteBolt11Response) => void = () => undefined;
      meltSubscribeSpy.mockImplementation(async ({ onUpdate }) => {
        emitMelt = onUpdate;
        return () => undefined;
      });

      const processor = createCashuReceiveQuoteProcessor({
        queryClient: new QueryClient(),
        cashuReceiveQuoteService: {
          completeReceive: mock(),
          expire: mock(),
          fail: mock(),
          markMeltInitiated: mock(),
        } as unknown as CashuReceiveQuoteService,
        cashuReceiveQuoteCache: {
          updateIfExists: mock(),
        } as unknown as CashuReceiveQuoteCache,
        pendingCashuReceiveQuotesCache: pendingCache,
        accountsCache,
        invalidateTransaction: mock(async () => undefined),
        pendingCashuQuotesOptions: () => ({
          queryKey: ['pending-cashu-receive-quotes'],
          queryFn: async () => [...cacheStore.values()],
          staleTime: Number.POSITIVE_INFINITY,
        }),
      });

      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(meltProofsIdempotent).toHaveBeenCalledTimes(1);
      const callArgs = meltProofsIdempotent.mock.calls[0];
      expect(callArgs?.[0]).toEqual({ quote: 'melt-quote-1', amount: 100 });
      expect(callArgs?.[3]).toEqual({ type: 'random' });

      processor.deactivate();
    });

    it('melt UNPAID & already-initiated -> fail', async () => {
      const { processor, service, emitMelt } = setup({
        initialQuotes: [tokenQuote({}, true)],
      });
      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(service.fail).toHaveBeenCalledTimes(1);
      expect(service.fail.mock.calls[0]).toEqual([
        expect.objectContaining({ id: 'receive-quote-token-1' }),
        'Cashu token melt failed.',
      ]);
    });

    it('melt PENDING -> markMeltInitiated', async () => {
      const { processor, service, emitMelt } = setup({
        initialQuotes: [tokenQuote()],
      });
      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.PENDING));
      await settle();

      expect(service.markMeltInitiated).toHaveBeenCalledTimes(1);
    });

    it('MintOperationError on initiateMelt -> fail cascade', async () => {
      const account = cashuAccount();
      const meltProofsIdempotent = mock(async () => {
        throw new MintOperationError(20001, 'mint rejected');
      });
      const sourceAccount = {
        id: 'source-account',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: SOURCE_MINT_URL,
        isOnline: true,
        wallet: { meltProofsIdempotent },
      } as unknown as CashuAccount;
      const accountsCache = {
        get: (id: string): Account | null =>
          id === account.id ? account : null,
        getAll: (): Account[] => [account, sourceAccount],
      } as unknown as AccountsCache;

      const cacheStore = new Map<string, CashuReceiveQuote>([
        ['receive-quote-token-1', tokenQuote()],
      ]);
      const pendingCache = {
        get: (id: string) => cacheStore.get(id),
        update: mock(() => undefined),
        getByMintQuoteId: () => undefined,
        getByMeltQuoteId: (meltQuoteId: string) =>
          [...cacheStore.values()].find(
            (q) =>
              q.type === 'CASHU_TOKEN' &&
              q.tokenReceiveData.meltQuoteId === meltQuoteId,
          ),
      } as unknown as PendingCashuReceiveQuotesCache;
      const failMock = mock(
        async (_quote: CashuReceiveQuote, _reason: string): Promise<void> =>
          undefined,
      );

      let emitMelt: (m: MeltQuoteBolt11Response) => void = () => undefined;
      meltSubscribeSpy.mockImplementation(async ({ onUpdate }) => {
        emitMelt = onUpdate;
        return () => undefined;
      });

      const processor = createCashuReceiveQuoteProcessor({
        queryClient: new QueryClient(),
        cashuReceiveQuoteService: {
          completeReceive: mock(),
          expire: mock(),
          fail: failMock,
          markMeltInitiated: mock(),
        } as unknown as CashuReceiveQuoteService,
        cashuReceiveQuoteCache: {
          updateIfExists: mock(),
        } as unknown as CashuReceiveQuoteCache,
        pendingCashuReceiveQuotesCache: pendingCache,
        accountsCache,
        invalidateTransaction: mock(async () => undefined),
        pendingCashuQuotesOptions: () => ({
          queryKey: ['pending-cashu-receive-quotes'],
          queryFn: async () => [...cacheStore.values()],
          staleTime: Number.POSITIVE_INFINITY,
        }),
      });

      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(failMock).toHaveBeenCalledTimes(1);
      expect(failMock.mock.calls[0]).toEqual([
        expect.objectContaining({ id: 'receive-quote-token-1' }),
        'mint rejected',
      ]);

      processor.deactivate();
    });
  });

  describe('the updated-in-the-meantime guard', () => {
    it('early-returns from complete when the entity is gone from the cache', async () => {
      const { processor, service, cacheStore, emitMint } = setup();
      processor.activate();
      await settle();

      cacheStore.clear();
      emitMint(mintQuote('PAID'));
      await settle();

      // getByMintQuoteId returns nothing, so no transition is dispatched.
      expect(service.completeReceive).not.toHaveBeenCalled();
    });
  });

  describe('scope serialization', () => {
    it('dispatches mint + melt transitions under the per-quote scope', async () => {
      const { processor, queryClient, emitMelt } = setup({
        initialQuotes: [tokenQuote()],
      });
      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.PENDING));
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);

      expect(scopeIds).toContain('cashu-receive-quote-receive-quote-token-1');
    });
  });
});
