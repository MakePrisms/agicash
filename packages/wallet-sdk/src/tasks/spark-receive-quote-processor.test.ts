import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { MeltQuoteSubscriptionManager } from '@agicash/cashu';
import { Money } from '@agicash/utils/money';
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  MintOperationError,
} from '@cashu/cashu-ts';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from '../receive/spark-receive-quote-cache';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import { createSparkReceiveQuoteProcessor } from './spark-receive-quote-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const SPARK_ACCOUNT_ID = 'spark-account-1';
const SOURCE_MINT_URL = 'https://source-mint.example';
const PAYMENT_HASH = 'payment-hash-1';
const PAYMENT_REQUEST = 'lnbc-invoice-1';

const lightningQuote = (
  overrides: Partial<SparkReceiveQuote> = {},
): SparkReceiveQuote =>
  ({
    id: 'spark-receive-quote-1',
    accountId: SPARK_ACCOUNT_ID,
    transactionId: 'tx-1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    paymentRequest: PAYMENT_REQUEST,
    paymentHash: PAYMENT_HASH,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    version: 0,
    ...overrides,
  }) as unknown as SparkReceiveQuote;

const tokenQuote = (
  overrides: Partial<SparkReceiveQuote> = {},
  meltInitiated = false,
): SparkReceiveQuote =>
  ({
    id: 'spark-receive-quote-token-1',
    accountId: SPARK_ACCOUNT_ID,
    transactionId: 'tx-token-1',
    type: 'CASHU_TOKEN',
    state: 'UNPAID',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    paymentRequest: 'lnbc-invoice-token-1',
    paymentHash: 'payment-hash-token-1',
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
  }) as unknown as SparkReceiveQuote;

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

/** A Breez `Payment` of the lightning variant carrying the htlc hash/preimage.
 * Pass `preimage: undefined` explicitly to model the no-preimage case (an
 * absent key keeps the default). */
const lightningPayment = (
  overrides: {
    id?: string;
    paymentHash?: string;
    preimage?: string;
    status?: string;
  } = {},
) =>
  ({
    id: overrides.id ?? 'spark-transfer-1',
    status: overrides.status ?? 'completed',
    details: {
      type: 'lightning',
      htlcDetails: {
        paymentHash: overrides.paymentHash ?? PAYMENT_HASH,
        preimage: 'preimage' in overrides ? overrides.preimage : 'preimage-1',
      },
    },
  }) as unknown as import('@agicash/breez-sdk-spark').Payment;

type SparkWalletMock = {
  addEventListener: ReturnType<typeof mock>;
  removeEventListener: ReturnType<typeof mock>;
  getPaymentByInvoice: ReturnType<typeof mock>;
  /** Pushes an event through the registered saga listener's onEvent. */
  emit: (event: unknown) => void;
};

const sparkAccount = (
  options: { initialPayment?: unknown } = {},
): { account: SparkAccount; wallet: SparkWalletMock } => {
  let onEvent: ((event: unknown) => void) | null = null;
  let nextId = 0;
  let activeId: string | null = null;
  const addEventListener = mock(
    async (listener: { onEvent: typeof onEvent }) => {
      onEvent = listener.onEvent;
      activeId = `listener-id-${++nextId}`;
      return activeId;
    },
  );
  // Model the real SDK: removing the active listener stops events from firing.
  const removeEventListener = mock(async (id: string) => {
    if (id === activeId) {
      onEvent = null;
      activeId = null;
    }
    return true;
  });
  const getPaymentByInvoice = mock(async () => ({
    payment: options.initialPayment,
  }));

  const wallet: SparkWalletMock = {
    addEventListener,
    removeEventListener,
    getPaymentByInvoice,
    emit: (event) => onEvent?.(event),
  };

  const account = {
    id: SPARK_ACCOUNT_ID,
    type: 'spark',
    isOnline: true,
    wallet,
  } as unknown as SparkAccount;

  return { account, wallet };
};

type Harness = {
  queryClient: QueryClient;
  cacheStore: Map<string, SparkReceiveQuote>;
  pendingCache: PendingSparkReceiveQuotesCache;
  cacheRemove: ReturnType<typeof mock>;
  cacheUpdate: ReturnType<typeof mock>;
  quoteCacheUpdateIfExists: ReturnType<typeof mock>;
  invalidateTransaction: ReturnType<typeof mock>;
  service: { [K in keyof SparkReceiveQuoteService]: ReturnType<typeof mock> };
  account: SparkAccount;
  wallet: SparkWalletMock;
  /** Pushes a melt-quote update through the registered melt-WS onUpdate. */
  emitMelt: (m: MeltQuoteBolt11Response) => void;
};

const setup = (
  options: {
    initialQuotes?: SparkReceiveQuote[];
    serviceOverrides?: Partial<Record<keyof SparkReceiveQuoteService, unknown>>;
    initialPayment?: unknown;
    extraAccounts?: Account[];
  } = {},
): {
  processor: ReturnType<typeof createSparkReceiveQuoteProcessor>;
} & Harness => {
  const queryClient = new QueryClient();
  const initial = options.initialQuotes ?? [lightningQuote()];
  const cacheStore = new Map(initial.map((q) => [q.id, q]));

  const cacheRemove = mock((quote: SparkReceiveQuote) => {
    cacheStore.delete(quote.id);
  });
  const cacheUpdate = mock((quote: SparkReceiveQuote) => {
    cacheStore.set(quote.id, quote);
  });
  const pendingCache = {
    get: (id: string) => cacheStore.get(id),
    remove: cacheRemove,
    update: cacheUpdate,
    getByMeltQuoteId: (meltQuoteId: string) =>
      [...cacheStore.values()].find(
        (q) =>
          q.type === 'CASHU_TOKEN' &&
          q.tokenReceiveData.meltQuoteId === meltQuoteId,
      ),
  } as unknown as PendingSparkReceiveQuotesCache;

  const quoteCacheUpdateIfExists = mock(() => undefined);
  const sparkReceiveQuoteCache = {
    updateIfExists: quoteCacheUpdateIfExists,
  } as unknown as SparkReceiveQuoteCache;

  const { account, wallet } = sparkAccount({
    initialPayment: options.initialPayment,
  });
  const accountsCache = {
    get: (id: string): Account | null =>
      id === account.id
        ? account
        : (options.extraAccounts?.find((a) => a.id === id) ?? null),
    getAll: (): Account[] => [account, ...(options.extraAccounts ?? [])],
  } as unknown as AccountsCache;

  const invalidateTransaction = mock(async () => undefined);

  const service = {
    complete: mock(async (quote: SparkReceiveQuote) => ({
      ...quote,
      state: 'PAID',
      version: quote.version + 1,
    })),
    expire: mock(async () => undefined),
    fail: mock(async () => undefined),
    markMeltInitiated: mock(async (quote: SparkReceiveQuote) => quote),
    ...options.serviceOverrides,
  } as unknown as Harness['service'];

  let emitMelt: (m: MeltQuoteBolt11Response) => void = () => undefined;
  meltSubscribeSpy.mockImplementation(async ({ onUpdate }) => {
    emitMelt = onUpdate;
    return () => undefined;
  });

  const processor = createSparkReceiveQuoteProcessor({
    queryClient,
    sparkReceiveQuoteService: service as unknown as SparkReceiveQuoteService,
    sparkReceiveQuoteCache,
    pendingSparkReceiveQuotesCache: pendingCache,
    accountsCache,
    invalidateTransaction,
    pendingSparkQuotesOptions: () => ({
      queryKey: ['pending-spark-receive-quotes'],
      queryFn: async () => [...cacheStore.values()],
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    cacheStore,
    pendingCache,
    cacheRemove,
    cacheUpdate,
    quoteCacheUpdateIfExists,
    invalidateTransaction,
    service,
    account,
    wallet,
    emitMelt: (m) => emitMelt(m),
  };
};

let meltSubscribeSpy: ReturnType<typeof mock>;
let originalMeltSubscribe: MeltQuoteSubscriptionManager['subscribe'];

beforeEach(() => {
  originalMeltSubscribe = MeltQuoteSubscriptionManager.prototype.subscribe;
  meltSubscribeSpy = mock(async () => () => undefined);
  MeltQuoteSubscriptionManager.prototype.subscribe =
    meltSubscribeSpy as unknown as MeltQuoteSubscriptionManager['subscribe'];
});

afterEach(() => {
  MeltQuoteSubscriptionManager.prototype.subscribe = originalMeltSubscribe;
});

describe('createSparkReceiveQuoteProcessor', () => {
  describe('the leader gate', () => {
    it('does not register the Breez listener while inactive (follower)', async () => {
      const { wallet } = setup();
      await settle();
      expect(wallet.addEventListener).not.toHaveBeenCalled();
    });

    it('registers one Breez listener per spark account once activated (leader)', async () => {
      const { processor, wallet } = setup();
      processor.activate();
      await settle();
      expect(wallet.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('removes the listener and stops dispatching after deactivate', async () => {
      const { processor, service, wallet } = setup();
      processor.activate();
      await settle();

      processor.deactivate();
      await settle();
      expect(wallet.removeEventListener).toHaveBeenCalledTimes(1);

      // The listener is torn down, so a late event drives no transition.
      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();
      expect(service.complete).not.toHaveBeenCalled();
    });
  });

  describe('the spark-path transition table', () => {
    it('paymentSucceeded + preimage -> complete + invalidate tx + updateIfExists + pending REMOVE (not update)', async () => {
      const {
        processor,
        service,
        invalidateTransaction,
        quoteCacheUpdateIfExists,
        cacheRemove,
        cacheUpdate,
        wallet,
      } = setup();
      processor.activate();
      await settle();

      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();

      expect(service.complete).toHaveBeenCalledTimes(1);
      // complete(quote, paymentPreimage, sparkTransferId)
      expect(service.complete.mock.calls[0]?.[1]).toBe('preimage-1');
      expect(service.complete.mock.calls[0]?.[2]).toBe('spark-transfer-1');
      expect(invalidateTransaction).toHaveBeenCalledWith('tx-1');
      expect(quoteCacheUpdateIfExists).toHaveBeenCalledTimes(1);
      // Spark completion REMOVES from pending (differs from cashu-receive's update).
      expect(cacheRemove).toHaveBeenCalledTimes(1);
      expect(cacheUpdate).not.toHaveBeenCalled();
    });

    it('paymentSucceeded with no preimage -> no transition (logged, dropped)', async () => {
      const { processor, service, wallet } = setup();
      processor.activate();
      await settle();

      wallet.emit({
        type: 'paymentSucceeded',
        payment: lightningPayment({ preimage: undefined }),
      });
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });

    it('paymentSucceeded for an unknown payment hash -> no transition', async () => {
      const { processor, service, wallet } = setup();
      processor.activate();
      await settle();

      wallet.emit({
        type: 'paymentSucceeded',
        payment: lightningPayment({ paymentHash: 'some-other-hash' }),
      });
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });

    it('synced with a past-expiry quote -> expire', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [
          lightningQuote({
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        ],
      });
      processor.activate();
      await settle();

      wallet.emit({ type: 'synced' });
      await settle();

      expect(service.expire).toHaveBeenCalledTimes(1);
    });

    it('synced with a not-yet-expired quote -> no transition', async () => {
      const { processor, service, wallet } = setup();
      processor.activate();
      await settle();

      wallet.emit({ type: 'synced' });
      await settle();

      expect(service.expire).not.toHaveBeenCalled();
    });
  });

  describe('the spark initial-check completion path', () => {
    it('completes immediately when getPaymentByInvoice returns a completed payment', async () => {
      // No event emitted: the completion must come from the initial lookup that
      // runs right after the listener is registered.
      const { processor, service, wallet } = setup({
        initialPayment: lightningPayment(),
      });
      processor.activate();
      await settle();

      expect(wallet.getPaymentByInvoice).toHaveBeenCalledWith({
        invoice: PAYMENT_REQUEST,
      });
      expect(service.complete).toHaveBeenCalledTimes(1);
      expect(service.complete.mock.calls[0]?.[2]).toBe('spark-transfer-1');
    });

    it('does not complete when the initial payment is not completed', async () => {
      const { processor, service } = setup({
        initialPayment: lightningPayment({ status: 'pending' }),
      });
      processor.activate();
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });
  });

  describe('the updated-in-the-meantime guard', () => {
    it('early-returns from complete when the entity is gone from the cache', async () => {
      const { processor, service, cacheStore, wallet } = setup();
      processor.activate();
      await settle();

      cacheStore.clear();
      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });
  });

  describe('the melt leg', () => {
    const sourceAccount = () =>
      ({
        id: 'source-account',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: SOURCE_MINT_URL,
        isOnline: true,
        wallet: {
          meltProofsIdempotent: mock(
            async (
              _quote: { quote: string; amount: number },
              _proofs: unknown,
              _counter: unknown,
              _outputs: { type: string },
            ): Promise<void> => undefined,
          ),
        },
      }) as unknown as CashuAccount;

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
      const source = sourceAccount();
      const { processor, emitMelt } = setup({
        initialQuotes: [tokenQuote()],
        extraAccounts: [source],
      });
      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      const meltProofsIdempotent = (
        source.wallet as unknown as {
          meltProofsIdempotent: ReturnType<typeof mock>;
        }
      ).meltProofsIdempotent;
      expect(meltProofsIdempotent).toHaveBeenCalledTimes(1);
      const callArgs = meltProofsIdempotent.mock.calls[0];
      expect(callArgs?.[0]).toEqual({ quote: 'melt-quote-1', amount: 100 });
      expect(callArgs?.[3]).toEqual({ type: 'random' });
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
        expect.objectContaining({ id: 'spark-receive-quote-token-1' }),
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
      const source = sourceAccount();
      (
        source.wallet as unknown as {
          meltProofsIdempotent: ReturnType<typeof mock>;
        }
      ).meltProofsIdempotent = mock(async () => {
        throw new MintOperationError(20001, 'mint rejected');
      });
      const failMock = mock(
        async (_quote: SparkReceiveQuote, _reason: string): Promise<void> =>
          undefined,
      );
      const { processor, emitMelt } = setup({
        initialQuotes: [tokenQuote()],
        extraAccounts: [source],
        serviceOverrides: { fail: failMock },
      });
      processor.activate();
      await settle();

      emitMelt(meltQuote(MeltQuoteState.UNPAID));
      await settle();

      expect(failMock).toHaveBeenCalledTimes(1);
      expect(failMock.mock.calls[0]).toEqual([
        expect.objectContaining({ id: 'spark-receive-quote-token-1' }),
        'mint rejected',
      ]);
    });
  });

  describe('scope serialization (incl the preserved melt-path typo)', () => {
    it('spark-path uses the hyphenated scope; melt-path uses the typo (no hyphen)', async () => {
      const { processor, queryClient, wallet, emitMelt } = setup({
        initialQuotes: [tokenQuote()],
      });
      processor.activate();
      await settle();

      // Spark-path: paymentSucceeded dispatches complete under the hyphenated scope.
      wallet.emit({
        type: 'paymentSucceeded',
        payment: lightningPayment({ paymentHash: 'payment-hash-token-1' }),
      });
      // Melt-path: PENDING dispatches markMeltInitiated under the typo'd scope.
      emitMelt(meltQuote(MeltQuoteState.PENDING));
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);

      // The spark-path scope has the hyphen.
      expect(scopeIds).toContain(
        'spark-receive-quote-spark-receive-quote-token-1',
      );
      // The melt-path scope is MISSING the hyphen (preserved quirk).
      expect(scopeIds).toContain(
        'spark-receive-quotespark-receive-quote-token-1',
      );
    });
  });
});
