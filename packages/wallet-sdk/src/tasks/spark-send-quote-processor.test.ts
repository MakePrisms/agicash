import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/utils/money';
import { QueryClient } from '@tanstack/query-core';
import type { Account, SparkAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import { DomainError } from '../error';
import type { SparkSendQuote } from '../send/spark-send-quote';
import type { UnresolvedSparkSendQuotesCache } from '../send/spark-send-quote-cache';
import type { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { createSparkSendQuoteProcessor } from './spark-send-quote-processor';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const SPARK_ACCOUNT_ID = 'spark-account-1';
const TRANSFER_ID = 'spark-transfer-1';

const unpaidQuote = (overrides: Partial<SparkSendQuote> = {}): SparkSendQuote =>
  ({
    id: 'spark-send-quote-1',
    accountId: SPARK_ACCOUNT_ID,
    transactionId: 'tx-1',
    userId: 'user-1',
    state: 'UNPAID',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    estimatedFee: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
    paymentRequest: 'lnbc-invoice-1',
    paymentHash: 'payment-hash-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentRequestIsAmountless: false,
    version: 0,
    ...overrides,
  }) as unknown as SparkSendQuote;

const pendingQuote = (
  overrides: Partial<SparkSendQuote> = {},
): SparkSendQuote =>
  ({
    id: 'spark-send-quote-1',
    accountId: SPARK_ACCOUNT_ID,
    transactionId: 'tx-1',
    userId: 'user-1',
    state: 'PENDING',
    sparkId: 'spark-id-1',
    sparkTransferId: TRANSFER_ID,
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    estimatedFee: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
    fee: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
    paymentRequest: 'lnbc-invoice-1',
    paymentHash: 'payment-hash-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentRequestIsAmountless: false,
    version: 0,
    ...overrides,
  }) as unknown as SparkSendQuote;

/** A Breez `Payment` of the lightning variant carrying the htlc preimage. Pass
 * `preimage: undefined` explicitly to model the no-preimage case (an absent key
 * keeps the default). */
const lightningPayment = (
  overrides: {
    id?: string;
    preimage?: string;
    status?: string;
  } = {},
) =>
  ({
    id: overrides.id ?? TRANSFER_ID,
    status: overrides.status ?? 'completed',
    details: {
      type: 'lightning',
      htlcDetails: {
        preimage: 'preimage' in overrides ? overrides.preimage : 'preimage-1',
      },
    },
  }) as unknown as import('@agicash/breez-sdk-spark').Payment;

type SparkWalletMock = {
  addEventListener: ReturnType<typeof mock>;
  removeEventListener: ReturnType<typeof mock>;
  getPayment: ReturnType<typeof mock>;
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
  // Default: the initial lookup finds a still-pending payment (status defined,
  // no transition) — tests that need completed/failed pass `initialPayment`.
  const getPayment = mock(async () => ({
    payment: options.initialPayment ?? lightningPayment({ status: 'pending' }),
  }));

  const wallet: SparkWalletMock = {
    addEventListener,
    removeEventListener,
    getPayment,
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
  cacheStore: Map<string, SparkSendQuote>;
  cacheRemove: ReturnType<typeof mock>;
  cacheUpdate: ReturnType<typeof mock>;
  service: { [K in keyof SparkSendQuoteService]: ReturnType<typeof mock> };
  account: SparkAccount;
  wallet: SparkWalletMock;
};

const setup = (
  options: {
    initialQuotes?: SparkSendQuote[];
    serviceOverrides?: Partial<Record<keyof SparkSendQuoteService, unknown>>;
    initialPayment?: unknown;
  } = {},
): {
  processor: ReturnType<typeof createSparkSendQuoteProcessor>;
} & Harness => {
  const queryClient = new QueryClient();
  const initial = options.initialQuotes ?? [unpaidQuote()];
  const cacheStore = new Map(initial.map((q) => [q.id, q]));

  const cacheRemove = mock((quote: SparkSendQuote) => {
    cacheStore.delete(quote.id);
  });
  const cacheUpdate = mock((quote: SparkSendQuote) => {
    cacheStore.set(quote.id, quote);
  });
  const unresolvedCache = {
    get: (id: string) => cacheStore.get(id),
    remove: cacheRemove,
    update: cacheUpdate,
  } as unknown as UnresolvedSparkSendQuotesCache;

  const { account, wallet } = sparkAccount({
    initialPayment: options.initialPayment,
  });
  const accountsCache = {
    get: (id: string): Account | null => (id === account.id ? account : null),
    getAll: (): Account[] => [account],
  } as unknown as AccountsCache;

  const service = {
    initiateSend: mock(
      async ({ sendQuote }: { sendQuote: SparkSendQuote }) => ({
        ...sendQuote,
        state: 'PENDING',
        sparkTransferId: TRANSFER_ID,
        version: sendQuote.version + 1,
      }),
    ),
    complete: mock(async (quote: SparkSendQuote) => ({
      ...quote,
      state: 'COMPLETED',
      version: quote.version + 1,
    })),
    fail: mock(async (quote: SparkSendQuote) => ({
      ...quote,
      state: 'FAILED',
      version: quote.version + 1,
    })),
    ...options.serviceOverrides,
  } as unknown as Harness['service'];

  const processor = createSparkSendQuoteProcessor({
    queryClient,
    sparkSendQuoteService: service as unknown as SparkSendQuoteService,
    unresolvedSparkSendQuotesCache: unresolvedCache,
    accountsCache,
    unresolvedSparkQuotesOptions: () => ({
      queryKey: ['unresolved-spark-send-quotes'],
      queryFn: async () => [...cacheStore.values()],
      staleTime: Number.POSITIVE_INFINITY,
    }),
  });

  return {
    processor,
    queryClient,
    cacheStore,
    cacheRemove,
    cacheUpdate,
    service,
    account,
    wallet,
  };
};

describe('createSparkSendQuoteProcessor', () => {
  describe('the leader gate', () => {
    it('does not initiate or register a listener while inactive (follower)', async () => {
      const { service, wallet } = setup({ initialQuotes: [pendingQuote()] });
      await settle();
      expect(service.initiateSend).not.toHaveBeenCalled();
      expect(wallet.addEventListener).not.toHaveBeenCalled();
    });

    it('registers one Breez listener per spark account for PENDING quotes once activated', async () => {
      const { processor, wallet } = setup({ initialQuotes: [pendingQuote()] });
      processor.activate();
      await settle();
      expect(wallet.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('removes the listener and stops dispatching after deactivate', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
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

  describe('the UNPAID -> initiate transition', () => {
    it('fires initiateSend immediately for an UNPAID quote and updates the cache on success', async () => {
      const { processor, service, cacheUpdate } = setup();
      processor.activate();
      await settle();

      expect(service.initiateSend).toHaveBeenCalledTimes(1);
      expect(service.initiateSend.mock.calls[0]?.[0]).toMatchObject({
        sendQuote: expect.objectContaining({ id: 'spark-send-quote-1' }),
      });
      // onSuccess writes the updated (now PENDING) quote back.
      expect(cacheUpdate).toHaveBeenCalledTimes(1);
    });

    it('skips initiation in the mutationFn unless the cached state is UNPAID', async () => {
      // The work-set delivers an UNPAID quote (so onUnpaid fires), but the
      // cache is flipped to PENDING before the mutation reads it: the
      // UNPAID-skip guard must prevent the service call.
      const quote = unpaidQuote();
      const { processor, service, cacheStore } = setup({
        initialQuotes: [quote],
      });
      cacheStore.set(quote.id, pendingQuote());
      processor.activate();
      await settle();

      expect(service.initiateSend).not.toHaveBeenCalled();
    });

    it('uses the spark-send-quote-${id} scope for initiate', async () => {
      const { processor, queryClient } = setup();
      processor.activate();
      await settle();

      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);
      expect(scopeIds).toContain('spark-send-quote-spark-send-quote-1');
    });

    it('cascades to fail when initiateSend throws a DomainError', async () => {
      const initiateSend = mock(async () => {
        throw new DomainError('Lightning invoice has already been paid.');
      });
      const { processor, service } = setup({
        serviceOverrides: { initiateSend },
      });
      processor.activate();
      await settle();

      expect(service.fail).toHaveBeenCalledTimes(1);
      expect(service.fail.mock.calls[0]?.[1]).toBe(
        'Lightning invoice has already been paid.',
      );
    });
  });

  describe('the paymentSucceeded -> complete transition', () => {
    it('completes with the extracted preimage and removes from the cache on success', async () => {
      const { processor, service, cacheRemove, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
      processor.activate();
      await settle();

      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();

      expect(service.complete).toHaveBeenCalledTimes(1);
      // complete(quote, paymentPreimage)
      expect(service.complete.mock.calls[0]?.[1]).toBe('preimage-1');
      expect(cacheRemove).toHaveBeenCalledTimes(1);
    });

    it('drops a paymentSucceeded with no preimage (no transition)', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
      processor.activate();
      await settle();

      wallet.emit({
        type: 'paymentSucceeded',
        payment: lightningPayment({ preimage: undefined }),
      });
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });

    it('ignores a paymentSucceeded for an unknown spark transfer id', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
      processor.activate();
      await settle();

      wallet.emit({
        type: 'paymentSucceeded',
        payment: lightningPayment({ id: 'some-other-transfer' }),
      });
      await settle();

      expect(service.complete).not.toHaveBeenCalled();
    });

    it('uses the spark-send-quote-${id} scope and early-returns from complete when the entity is gone', async () => {
      const { processor, service, queryClient, cacheStore, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
      processor.activate();
      await settle();

      cacheStore.clear();
      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();

      // The mutation was dispatched under the scope, but the service was not
      // called because the entity was gone from the cache.
      const scopeIds = queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.options.scope?.id);
      expect(scopeIds).toContain('spark-send-quote-spark-send-quote-1');
      expect(service.complete).not.toHaveBeenCalled();
    });
  });

  describe('the paymentFailed -> fail transition (expired vs failed reason)', () => {
    it('fails with the "payment failed" reason when the quote is not past expiry', async () => {
      const { processor, service, cacheRemove, wallet } = setup({
        initialQuotes: [
          pendingQuote({
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        ],
      });
      processor.activate();
      await settle();

      wallet.emit({ type: 'paymentFailed', payment: lightningPayment() });
      await settle();

      expect(service.fail).toHaveBeenCalledTimes(1);
      expect(service.fail.mock.calls[0]?.[1]).toBe('Lightning payment failed.');
      expect(cacheRemove).toHaveBeenCalledTimes(1);
    });

    it('fails with the "invoice expired" reason when the quote is past expiry', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [
          pendingQuote({
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        ],
      });
      processor.activate();
      await settle();

      wallet.emit({ type: 'paymentFailed', payment: lightningPayment() });
      await settle();

      expect(service.fail).toHaveBeenCalledTimes(1);
      expect(service.fail.mock.calls[0]?.[1]).toBe(
        'Lightning invoice expired.',
      );
    });
  });

  describe('the lastTriggeredState dedup (guards Breez re-fires)', () => {
    it('does not complete twice when paymentSucceeded re-fires for the same quote', async () => {
      const { processor, service, wallet } = setup({
        initialQuotes: [pendingQuote()],
      });
      processor.activate();
      await settle();

      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();
      // Re-fire the same event: the dedup map must suppress the second callback.
      wallet.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
      await settle();

      expect(service.complete).toHaveBeenCalledTimes(1);
    });

    it('does not re-fire onUnpaid (re-initiate) when the same UNPAID quote is delivered again', async () => {
      const quote = unpaidQuote();
      const { processor, service, cacheStore, queryClient } = setup({
        initialQuotes: [quote],
      });
      processor.activate();
      await settle();
      expect(service.initiateSend).toHaveBeenCalledTimes(1);

      // Re-deliver the same UNPAID work-set (a refetch). The dedup map keyed on
      // the quote's last-triggered UNPAID state suppresses a second initiate.
      cacheStore.set(quote.id, unpaidQuote());
      queryClient.invalidateQueries({
        queryKey: ['unresolved-spark-send-quotes'],
      });
      await settle();

      expect(service.initiateSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('the initial getPayment check', () => {
    it('completes immediately when getPayment reports a completed payment (no event)', async () => {
      // No event emitted: the completion must come from the initial lookup that
      // runs right after the listener is registered.
      const { processor, service, wallet } = setup({
        initialQuotes: [pendingQuote()],
        initialPayment: lightningPayment(),
      });
      processor.activate();
      await settle();

      expect(wallet.getPayment).toHaveBeenCalledWith({
        paymentId: TRANSFER_ID,
      });
      expect(service.complete).toHaveBeenCalledTimes(1);
      expect(service.complete.mock.calls[0]?.[1]).toBe('preimage-1');
    });

    it('fails immediately when getPayment reports a failed payment (no event)', async () => {
      const { processor, service } = setup({
        initialQuotes: [pendingQuote()],
        initialPayment: lightningPayment({ status: 'failed' }),
      });
      processor.activate();
      await settle();

      expect(service.fail).toHaveBeenCalledTimes(1);
    });
  });
});
