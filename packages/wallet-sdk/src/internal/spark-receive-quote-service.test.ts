import { describe, expect, mock, test } from 'bun:test';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { SparkReceiveQuote } from '../types/spark';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** Build a `SparkReceiveQuote` in the given state with sensible defaults. */
function baseQuote(
  overrides: Partial<SparkReceiveQuote> & {
    state?: SparkReceiveQuote['state'];
  },
): SparkReceiveQuote {
  return {
    id: overrides.id ?? 'rq1',
    sparkId: 's1',
    userId: 'u1',
    accountId: 'acc1',
    transactionId: 'tx1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    amount: sats(100),
    paymentRequest: 'lnbc1...',
    paymentHash: 'hash',
    totalFee: sats(0),
    version: 1,
    type: 'LIGHTNING',
    ...overrides,
  } as SparkReceiveQuote;
}

/** A minimal repo whose methods are spies. */
function fakeRepo(): SparkReceiveQuoteRepository {
  return {
    create: mock(async () => baseQuote({ state: 'UNPAID' })),
    complete: mock(async ({ quote }: { quote: SparkReceiveQuote }) =>
      baseQuote({ id: quote.id, state: 'PAID' } as never),
    ),
    expire: mock(async () => baseQuote({ state: 'EXPIRED' })),
    fail: mock(async () => undefined),
    markMeltInitiated: mock(async (q: SparkReceiveQuote) => q),
    get: mock(async () => null),
    getPending: mock(async () => []),
    toQuote: mock(async () => baseQuote({})),
  } as unknown as SparkReceiveQuoteRepository;
}

const account = { id: 'acc1', type: 'spark' } as SparkAccount;

/** A pre-built lightning quote (as the core's getLightningQuote would return). */
const lightningQuote: SparkReceiveLightningQuote = {
  id: 'spark-recv-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  invoice: {
    paymentRequest: 'lnbc-invoice',
    paymentHash: 'ph1',
    amount: sats(100) as Money<'BTC'>,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    memo: 'coffee',
  },
  status: 'PENDING' as never,
};

// -- Tests ----------------------------------------------------------------------------------

describe('SparkReceiveQuoteService.createReceiveQuote', () => {
  test('a LIGHTNING receive persists with a zero total fee + invoice data', async () => {
    const repo = fakeRepo();
    const service = new SparkReceiveQuoteService(repo);

    await service.createReceiveQuote({
      userId: 'u1',
      account,
      lightningQuote,
      receiveType: 'LIGHTNING',
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    const arg = (repo.create as ReturnType<typeof mock>).mock.calls[0][0];
    expect(arg.receiveType).toBe('LIGHTNING');
    expect(arg.paymentRequest).toBe('lnbc-invoice');
    expect(arg.sparkId).toBe('spark-recv-1');
    expect((arg.totalFee as Money).toNumber('sat')).toBe(0);
  });

  test('a CASHU_TOKEN receive persists the melt data + sums the fee', async () => {
    const repo = fakeRepo();
    const service = new SparkReceiveQuoteService(repo);

    await service.createReceiveQuote({
      userId: 'u1',
      account,
      lightningQuote,
      receiveType: 'CASHU_TOKEN',
      tokenAmount: sats(100),
      sourceMintUrl: 'https://mint.example',
      tokenProofs: [],
      meltQuoteId: 'melt-1',
      meltQuoteExpiresAt: '2026-01-01T00:30:00.000Z',
      cashuReceiveFee: sats(1),
      lightningFeeReserve: sats(2),
    });

    const arg = (repo.create as ReturnType<typeof mock>).mock.calls[0][0];
    expect(arg.receiveType).toBe('CASHU_TOKEN');
    expect(arg.meltData.tokenMintUrl).toBe('https://mint.example');
    expect(arg.meltData.meltQuoteId).toBe('melt-1');
    // totalFee = cashuReceiveFee + lightningFeeReserve = 3
    expect((arg.totalFee as Money).toNumber('sat')).toBe(3);
    // expiry is the earlier of the invoice + melt-quote expiry (the melt quote, here)
    expect(arg.expiresAt).toBe('2026-01-01T00:30:00.000Z');
  });
});

describe('SparkReceiveQuoteService state guards', () => {
  test('complete is a no-op when already PAID', async () => {
    const repo = fakeRepo();
    const service = new SparkReceiveQuoteService(repo);
    const paid = baseQuote({ state: 'PAID' } as never);

    const result = await service.complete(paid, 'preimage', 'transfer-1');

    expect(result).toBe(paid);
    expect(repo.complete).not.toHaveBeenCalled();
  });

  test('complete rejects a non-UNPAID state', async () => {
    const service = new SparkReceiveQuoteService(fakeRepo());
    await expect(
      service.complete(
        baseQuote({ state: 'FAILED', failureReason: 'x' } as never),
        'preimage',
        'transfer-1',
      ),
    ).rejects.toThrow(/not unpaid/);
  });

  test('expire rejects a not-yet-expired quote', async () => {
    const service = new SparkReceiveQuoteService(fakeRepo());
    const future = baseQuote({
      state: 'UNPAID',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(service.expire(future)).rejects.toThrow(/has not expired/);
  });

  test('fail is a no-op when already FAILED', async () => {
    const repo = fakeRepo();
    const service = new SparkReceiveQuoteService(repo);

    await service.fail(
      baseQuote({ state: 'FAILED', failureReason: 'x' } as never),
      'reason',
    );

    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('markMeltInitiated rejects a LIGHTNING (non-CASHU_TOKEN) quote', async () => {
    const service = new SparkReceiveQuoteService(fakeRepo());
    await expect(
      service.markMeltInitiated(
        baseQuote({ type: 'LIGHTNING', state: 'UNPAID' }) as never,
      ),
    ).rejects.toThrow(/must be of type CASHU_TOKEN/);
  });
});
