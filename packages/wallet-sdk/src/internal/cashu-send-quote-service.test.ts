import { describe, expect, mock, test } from 'bun:test';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { type Currency, Money } from '../types/money';
import type { CashuAccount } from '../types/account';
import type { CashuSendQuote } from '../types/cashu';

// -- Fakes ----------------------------------------------------------------------------------

/** A minimal repo whose methods are spies; each test stubs the ones it needs. */
function fakeRepo(): CashuSendQuoteRepository {
  return {
    markAsPending: mock(async (id: string) =>
      baseQuote({ id, state: 'PENDING' }),
    ),
    fail: mock(async ({ id }: { id: string; reason: string }) =>
      baseQuote({ id, state: 'FAILED', failureReason: 'r' }),
    ),
    complete: mock(async () => baseQuote({ state: 'PAID' })),
    expire: mock(async () => undefined),
    create: mock(async () => baseQuote({})),
    get: mock(async () => null),
    getUnresolved: mock(async () => []),
    toQuote: mock(async () => baseQuote({})),
  } as unknown as CashuSendQuoteRepository;
}

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** Build a `CashuSendQuote` in the given state with sensible defaults. */
function baseQuote(
  overrides: Partial<CashuSendQuote> & { state?: CashuSendQuote['state'] },
): CashuSendQuote {
  return {
    id: overrides.id ?? 'q1',
    userId: 'u1',
    accountId: 'acc1',
    transactionId: 'tx1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    paymentRequest: 'lnbc1...',
    paymentHash: 'hash',
    amountRequested: sats(100),
    amountRequestedInMsat: 100_000,
    amountReceived: sats(100),
    lightningFeeReserve: sats(1),
    cashuFee: sats(0),
    quoteId: 'melt1',
    proofs: [],
    amountReserved: sats(101),
    keysetId: 'ks1',
    keysetCounter: 0,
    numberOfChangeOutputs: 0,
    version: 1,
    ...overrides,
  } as CashuSendQuote;
}

const account = { id: 'acc1', type: 'cashu' } as CashuAccount;

// -- Tests ----------------------------------------------------------------------------------

describe('CashuSendQuoteService idempotency guards', () => {
  test('markSendQuoteAsPending is a no-op when already PENDING (does not hit the repo)', async () => {
    const repo = fakeRepo();
    const service = new CashuSendQuoteService(repo);
    const pending = baseQuote({ state: 'PENDING' });

    const result = await service.markSendQuoteAsPending(pending);

    expect(result).toBe(pending);
    expect(repo.markAsPending).not.toHaveBeenCalled();
  });

  test('markSendQuoteAsPending marks UNPAID via the repo', async () => {
    const repo = fakeRepo();
    const service = new CashuSendQuoteService(repo);

    await service.markSendQuoteAsPending(
      baseQuote({ id: 'q1', state: 'UNPAID' }),
    );

    expect(repo.markAsPending).toHaveBeenCalledWith('q1');
  });

  test('markSendQuoteAsPending rejects a non-UNPAID state', async () => {
    const service = new CashuSendQuoteService(fakeRepo());
    await expect(
      service.markSendQuoteAsPending(baseQuote({ state: 'PAID' } as never)),
    ).rejects.toThrow(/Only unpaid/);
  });

  test('completeSendQuote is a no-op when already PAID', async () => {
    const repo = fakeRepo();
    const service = new CashuSendQuoteService(repo);
    const paid = baseQuote({ state: 'PAID' } as never);

    const result = await service.completeSendQuote(account, paid, {} as never);

    expect(result).toBe(paid);
    expect(repo.complete).not.toHaveBeenCalled();
  });

  test('failSendQuote is a no-op when already FAILED', async () => {
    const repo = fakeRepo();
    const service = new CashuSendQuoteService(repo);
    const failed = baseQuote({ state: 'FAILED', failureReason: 'x' } as never);

    const result = await service.failSendQuote(account, failed, 'reason');

    expect(result).toBe(failed);
    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('failSendQuote rejects a non-pending/unpaid state', async () => {
    const service = new CashuSendQuoteService(fakeRepo());
    await expect(
      service.failSendQuote(
        account,
        baseQuote({ state: 'PAID' } as never),
        'r',
      ),
    ).rejects.toThrow(/not pending or unpaid/);
  });

  test('expireSendQuote rejects a not-yet-expired quote', async () => {
    const service = new CashuSendQuoteService(fakeRepo());
    const future = baseQuote({
      state: 'UNPAID',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(service.expireSendQuote(future)).rejects.toThrow(
      /has not expired/,
    );
  });

  test('initiateSend rejects when the account does not match', async () => {
    const service = new CashuSendQuoteService(fakeRepo());
    await expect(
      service.initiateSend(
        { id: 'other', type: 'cashu' } as CashuAccount,
        baseQuote({ state: 'UNPAID' }),
        { quote: 'melt1', amount: 100 },
      ),
    ).rejects.toThrow(/Account does not match/);
  });

  test('initiateSend rejects when the quote is not UNPAID', async () => {
    const service = new CashuSendQuoteService(fakeRepo());
    await expect(
      service.initiateSend(account, baseQuote({ state: 'PENDING' }), {
        quote: 'melt1',
        amount: 100,
      }),
    ).rejects.toThrow(/not unpaid/);
  });
});
