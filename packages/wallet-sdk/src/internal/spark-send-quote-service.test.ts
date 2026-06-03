import { describe, expect, mock, test } from 'bun:test';
import { SparkSendQuoteService } from './spark-send-quote-service';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import { DomainError } from '../errors';
import type { SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { SparkSendQuote } from '../types/spark';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** Build a `SparkSendQuote` in the given state with sensible defaults. */
function baseQuote(
  overrides: Partial<SparkSendQuote> & { state?: SparkSendQuote['state'] },
): SparkSendQuote {
  return {
    id: overrides.id ?? 'q1',
    userId: 'u1',
    accountId: 'acc1',
    transactionId: 'tx1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    amount: sats(100),
    estimatedFee: sats(2),
    paymentRequest: 'lnbc1...',
    paymentHash: 'hash',
    paymentRequestIsAmountless: false,
    version: 1,
    ...overrides,
  } as SparkSendQuote;
}

/** A minimal repo whose methods are spies; each test stubs the ones it needs. */
function fakeRepo(): SparkSendQuoteRepository {
  return {
    create: mock(async () => baseQuote({})),
    markAsPending: mock(async ({ quote }: { quote: SparkSendQuote }) =>
      baseQuote({
        id: quote.id,
        state: 'PENDING',
        sparkId: 's1',
        sparkTransferId: 'st1',
        fee: sats(1),
      } as never),
    ),
    complete: mock(async ({ quote }: { quote: SparkSendQuote }) =>
      baseQuote({ id: quote.id, state: 'COMPLETED' } as never),
    ),
    fail: mock(async (id: string) =>
      baseQuote({ id, state: 'FAILED', failureReason: 'r' } as never),
    ),
    get: mock(async () => null),
    getUnresolved: mock(async () => []),
    toQuote: mock(async () => baseQuote({})),
  } as unknown as SparkSendQuoteRepository;
}

/**
 * A mock spark account whose live Breez `wallet` exposes the two send primitives the service
 * calls. `prepareSendPayment` returns a bolt11Invoice payment method with a fixed fee;
 * `sendPayment` returns a successful lightning send (or throws what the test queues).
 */
function fakeSparkAccount(
  opts: {
    lightningFeeSats?: number;
    balance?: Money;
    sendPaymentThrows?: unknown;
  } = {},
): { account: SparkAccount; sendPayment: ReturnType<typeof mock> } {
  const sendPayment = mock(async (_args: unknown) => {
    if (opts.sendPaymentThrows) {
      throw opts.sendPaymentThrows;
    }
    return {
      payment: { id: 'transfer-1', fees: 1n },
      lightningSendDetails: { sendRequestId: 'send-req-1' },
    };
  });
  const account = {
    id: 'acc1',
    type: 'spark',
    currency: 'BTC',
    balance: opts.balance ?? sats(10_000),
    wallet: {
      prepareSendPayment: mock(async (_args: unknown) => ({
        paymentMethod: {
          type: 'bolt11Invoice',
          lightningFeeSats: opts.lightningFeeSats ?? 1,
        },
      })),
      sendPayment,
    },
  } as unknown as SparkAccount;
  return { account, sendPayment };
}

// -- Tests ----------------------------------------------------------------------------------

describe('SparkSendQuoteService state guards', () => {
  test('complete is a no-op when already COMPLETED (does not hit the repo)', async () => {
    const repo = fakeRepo();
    const service = new SparkSendQuoteService(repo);
    const completed = baseQuote({ state: 'COMPLETED' } as never);

    const result = await service.complete(completed, 'preimage');

    expect(result).toBe(completed);
    expect(repo.complete).not.toHaveBeenCalled();
  });

  test('complete rejects a non-PENDING state', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    await expect(
      service.complete(baseQuote({ state: 'UNPAID' }), 'preimage'),
    ).rejects.toThrow(/not pending/);
  });

  test('fail is a no-op when already FAILED', async () => {
    const repo = fakeRepo();
    const service = new SparkSendQuoteService(repo);
    const failed = baseQuote({ state: 'FAILED', failureReason: 'x' } as never);

    const result = await service.fail(failed, 'reason');

    expect(result).toBe(failed);
    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('fail rejects a COMPLETED state', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    await expect(
      service.fail(baseQuote({ state: 'COMPLETED' } as never), 'r'),
    ).rejects.toThrow(/not unpaid or pending/);
  });
});

describe('SparkSendQuoteService.initiateSend (Breez-driven send)', () => {
  test('is a no-op when already PENDING (does not call the wallet)', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    const { account, sendPayment } = fakeSparkAccount();
    const pending = baseQuote({
      state: 'PENDING',
      sparkId: 's1',
      sparkTransferId: 'st1',
      fee: sats(1),
    } as never);

    const result = await service.initiateSend({ account, sendQuote: pending });

    expect(result).toBe(pending);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  test('rejects a non-UNPAID, non-PENDING state', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    const { account } = fakeSparkAccount();
    await expect(
      service.initiateSend({
        account,
        sendQuote: baseQuote({ state: 'FAILED', failureReason: 'x' } as never),
      }),
    ).rejects.toThrow(/not UNPAID/);
  });

  test('drives Breez sendPayment with the quote id as the idempotency key, then marks PENDING', async () => {
    const repo = fakeRepo();
    const service = new SparkSendQuoteService(repo);
    const { account, sendPayment } = fakeSparkAccount();
    const quote = baseQuote({ id: 'q-idem', state: 'UNPAID' });

    const result = await service.initiateSend({ account, sendQuote: quote });

    // The send is keyed by the quote id — the idempotency keystone (a re-issued send is safe).
    expect(sendPayment).toHaveBeenCalledTimes(1);
    expect(sendPayment.mock.calls[0][0].idempotencyKey).toBe('q-idem');
    // Routed over Lightning, not Spark.
    expect(sendPayment.mock.calls[0][0].options).toEqual({
      type: 'bolt11Invoice',
      preferSpark: false,
    });
    // The repo is asked to mark it PENDING with the spark ids from the send result.
    expect(repo.markAsPending).toHaveBeenCalledTimes(1);
    expect(
      (repo.markAsPending as ReturnType<typeof mock>).mock.calls[0][0],
    ).toMatchObject({
      sparkSendRequestId: 'send-req-1',
      sparkTransferId: 'transfer-1',
    });
    expect(result.state).toBe('PENDING');
  });

  test('rejects (DomainError) when the live fee exceeds the confirmed estimate', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    // Quote confirmed at a 2-sat estimate; the wallet now quotes 5 sats.
    const { account } = fakeSparkAccount({ lightningFeeSats: 5 });
    await expect(
      service.initiateSend({
        account,
        sendQuote: baseQuote({ state: 'UNPAID', estimatedFee: sats(2) }),
      }),
    ).rejects.toThrow(/fee has changed/);
  });

  test('maps an already-paid Breez error to a DomainError', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    const { account } = fakeSparkAccount({
      sendPaymentThrows: new Error('preimage request already exists'),
    });
    await expect(
      service.initiateSend({
        account,
        sendQuote: baseQuote({ state: 'UNPAID' }),
      }),
    ).rejects.toThrow(/already been paid/);
  });

  test('maps an insufficient-balance Breez error to a DomainError', async () => {
    const service = new SparkSendQuoteService(fakeRepo());
    const { account } = fakeSparkAccount({
      sendPaymentThrows: new Error('insufficient funds for the transaction'),
    });
    const error = await service
      .initiateSend({
        account,
        sendQuote: baseQuote({ state: 'UNPAID' }),
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.message).toMatch(/Insufficient balance/);
  });
});
