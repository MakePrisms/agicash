import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Money } from '@agicash/money';
import { SdkError } from '../../errors';
import * as bolt11 from '../../internal/lib/bolt11';
import type { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import { SparkSendQuoteService } from './spark-send-quote-service';

// ---------------------------------------------------------------------------
// A real bolt11 invoice (mainnet, spec test vector) so parseBolt11Invoice works.
// Amount: 250,000 sat (= 2500u), expiry: 1496314718000ms (in the past; fine for
// expiry-insensitive tests — the service only checks expiry in createSendQuote).
// ---------------------------------------------------------------------------
const REAL_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
// Payment hash decoded from the spec invoice above.
const REAL_INVOICE_PAYMENT_HASH =
  '0001020304050607080900010203040506070809000102030405060708090102';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btc(amount: number, unit: 'sat' | 'msat' = 'sat'): Money<'BTC'> {
  return new Money({ amount, currency: 'BTC', unit }) as Money<'BTC'>;
}

type FakeRepo = Pick<
  SparkSendQuoteRepository,
  'create' | 'markAsPending' | 'complete' | 'fail' | 'get' | 'getUnresolved'
>;

function makeFakeRepo(
  overrides: Partial<FakeRepo> = {},
): SparkSendQuoteRepository {
  const base: FakeRepo = {
    create: async () => makeUnpaidQuote(),
    markAsPending: async (args) =>
      ({
        ...args.quote,
        state: 'PENDING',
        sparkId: args.sparkSendRequestId,
        sparkTransferId: args.sparkTransferId,
        fee: args.fee,
      }) as unknown as SparkSendQuote,
    complete: async (args) =>
      ({
        ...args.quote,
        state: 'COMPLETED',
        sparkId: 'sr1',
        sparkTransferId: 't1',
        fee: btc(2),
        paymentPreimage: args.paymentPreimage,
      }) as unknown as SparkSendQuote,
    fail: async (id: string, failureReason: string) =>
      ({ id, state: 'FAILED', failureReason }) as unknown as SparkSendQuote,
    get: async () => null,
    getUnresolved: async () => [],
  };
  return { ...base, ...overrides } as unknown as SparkSendQuoteRepository;
}

function makeUnpaidQuote(
  overrides: Partial<SparkSendQuote> = {},
): SparkSendQuote {
  return {
    id: 'q1',
    createdAt: '2024-01-01T00:00:00Z',
    expiresAt: null,
    amount: btc(250_000) as Money,
    estimatedFee: btc(5) as Money,
    paymentRequest: REAL_INVOICE,
    paymentHash: REAL_INVOICE_PAYMENT_HASH,
    transactionId: 'txn-1',
    userId: 'user-1',
    accountId: 'acc-1',
    version: 1,
    paymentRequestIsAmountless: false,
    state: 'UNPAID',
    ...overrides,
  } as SparkSendQuote;
}

function makePendingQuote(
  overrides: Partial<SparkSendQuote> = {},
): SparkSendQuote {
  return {
    ...makeUnpaidQuote(),
    state: 'PENDING',
    sparkId: 'sr1',
    sparkTransferId: 't1',
    fee: btc(2) as Money,
    ...overrides,
  } as unknown as SparkSendQuote;
}

function makeCompletedQuote(): SparkSendQuote {
  return {
    ...makePendingQuote(),
    state: 'COMPLETED',
    paymentPreimage: 'preimage-abc',
  } as unknown as SparkSendQuote;
}

function makeFailedQuote(): SparkSendQuote {
  return {
    ...makeUnpaidQuote(),
    state: 'FAILED',
    failureReason: 'failed',
  } as unknown as SparkSendQuote;
}

/** Build a fake SparkAccount with the given wallet implementation. */
function makeAccount(
  walletOverrides: Partial<{
    prepareSendPayment: (r: unknown) => Promise<unknown>;
    sendPayment: (r: unknown) => Promise<unknown>;
  }> = {},
  balanceSats = 1_000_000,
): SparkAccount {
  return {
    id: 'acc-1',
    name: 'Spark',
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2024-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    network: 'MAINNET',
    balance: btc(balanceSats) as Money,
    wallet: {
      prepareSendPayment: async () => ({
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
      }),
      sendPayment: async () => ({
        payment: { id: 't1', fees: 2n },
        lightningSendDetails: { sendRequestId: 'sr1' },
      }),
      ...walletOverrides,
    },
  } as unknown as SparkAccount;
}

// ---------------------------------------------------------------------------
// Stub decoded invoice used by the two spyOn-based tests below.
// expiryUnixMs is far in the future so the expiry guard passes.
// ---------------------------------------------------------------------------
const STUB_PAYMENT_HASH =
  'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const STUB_DECODED: bolt11.DecodedBolt11 = {
  amountMsat: 100_000,
  amountSat: 100,
  createdAtUnixMs: Date.UTC(2025, 0, 1),
  expiryUnixMs: Date.UTC(2099, 0, 1),
  network: 'bitcoin',
  description: undefined,
  payeeNodeKey:
    '02deadbeef00000000000000000000000000000000000000000000000000000000',
  paymentHash: STUB_PAYMENT_HASH,
};

// ---------------------------------------------------------------------------
// Tests: getLightningSendQuote
// Note: REAL_INVOICE is a 2017 spec test vector — it is expired. All available
// bolt11 test vectors are expired, so the happy-path (prepareSendPayment call)
// and insufficient-balance paths cannot be tested via getLightningSendQuote
// directly without a non-expired invoice. The two spyOn-based tests below
// stub parseBolt11Invoice to return a non-expired decoded invoice and cover
// those paths directly.
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.getLightningSendQuote', () => {
  let parseSpy: ReturnType<typeof spyOn<typeof bolt11, 'parseBolt11Invoice'>>;

  afterEach(() => {
    parseSpy?.mockRestore();
  });

  it('throws DomainError(invalid_invoice) for an invalid invoice string', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.getLightningSendQuote({
        account: makeAccount(),
        paymentRequest: 'not-a-bolt11',
      }),
    ).rejects.toMatchObject({ code: 'invalid_invoice' });
  });

  it('throws DomainError(expired) for an expired invoice (spec test vector, 2017)', async () => {
    // REAL_INVOICE expires at 1496314718000ms (June 2017) — definitively in the past.
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.getLightningSendQuote({
        account: makeAccount(),
        paymentRequest: REAL_INVOICE,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('throws DomainError(amount_required) for an amountless invoice when no amount arg is supplied', async () => {
    parseSpy = spyOn(bolt11, 'parseBolt11Invoice').mockReturnValue({
      valid: true,
      encoded: 'lnbc1amountless',
      decoded: { ...STUB_DECODED, amountMsat: undefined, amountSat: undefined },
    });

    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.getLightningSendQuote({
        account: makeAccount(),
        paymentRequest: 'lnbc1amountless',
        // intentionally no `amount` arg
      }),
    ).rejects.toMatchObject({ code: 'amount_required' });
  });

  it('happy path: returns SparkLightningQuote with correct fields when balance is sufficient', async () => {
    parseSpy = spyOn(bolt11, 'parseBolt11Invoice').mockReturnValue({
      valid: true,
      encoded: 'lnbc1stubbed',
      decoded: STUB_DECODED,
    });

    let prepareCalled = false;
    const account = makeAccount(
      {
        prepareSendPayment: async () => {
          prepareCalled = true;
          return {
            paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
          };
        },
      },
      1_000,
    );

    const svc = new SparkSendQuoteService(makeFakeRepo());
    const result = await svc.getLightningSendQuote({
      account,
      paymentRequest: 'lnbc1stubbed',
    });

    // Confirm the spy actually redirected the service's call to parseBolt11Invoice.
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(prepareCalled).toBe(true);

    expect(result.paymentHash).toBe(STUB_PAYMENT_HASH);
    expect(result.estimatedLightningFee.toNumber('sat')).toBe(1);
    // amountMsat = 100_000 msat = 100 sat; fee = 1 sat → total = 101 sat
    expect(result.estimatedTotalAmount.toNumber('sat')).toBe(101);
    expect(result.paymentRequestIsAmountless).toBe(false);
  });

  it('throws DomainError(insufficient_balance) when balance is less than estimated total', async () => {
    parseSpy = spyOn(bolt11, 'parseBolt11Invoice').mockReturnValue({
      valid: true,
      encoded: 'lnbc1stubbed',
      decoded: STUB_DECODED,
    });

    // balance = 1 sat, but total = 100 sat amount + 1 sat fee = 101 sat
    const account = makeAccount(
      {
        prepareSendPayment: async () => ({
          paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
        }),
      },
      1,
    );

    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.getLightningSendQuote({ account, paymentRequest: 'lnbc1stubbed' }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
  });
});

// ---------------------------------------------------------------------------
// Tests: initiateSend
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.initiateSend', () => {
  it('returns PENDING quote as-is (idempotent)', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    const pending = makePendingQuote();
    const result = await svc.initiateSend({
      account: makeAccount(),
      sendQuote: pending,
    });
    expect(result).toBe(pending);
  });

  it('throws DomainError(invalid_state) for non-UNPAID, non-PENDING state', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    for (const quote of [makeCompletedQuote(), makeFailedQuote()]) {
      await expect(
        svc.initiateSend({ account: makeAccount(), sendQuote: quote }),
      ).rejects.toMatchObject({ code: 'invalid_state' });
    }
  });

  it('UNPAID happy path: calls sendPayment then markAsPending, returns PENDING', async () => {
    let markArgs:
      | Parameters<SparkSendQuoteRepository['markAsPending']>[0]
      | undefined;
    const repo = makeFakeRepo({
      markAsPending: async (args) => {
        markArgs = args;
        return {
          ...args.quote,
          state: 'PENDING',
          sparkId: args.sparkSendRequestId,
          sparkTransferId: args.sparkTransferId,
          fee: args.fee,
        } as unknown as SparkSendQuote;
      },
    });
    const svc = new SparkSendQuoteService(repo);
    const unpaid = makeUnpaidQuote();
    const result = await svc.initiateSend({
      account: makeAccount(),
      sendQuote: unpaid,
    });

    expect(result.state).toBe('PENDING');
    expect(markArgs).toBeDefined();
    expect(markArgs?.sparkTransferId).toBe('t1');
    expect(markArgs?.sparkSendRequestId).toBe('sr1');
    expect(markArgs?.fee.toNumber('sat')).toBe(2); // Number(2n) = 2
  });

  it('throws DomainError(fee_changed) when prepareSendPayment returns higher fee than estimated', async () => {
    const account = makeAccount({
      prepareSendPayment: async () => ({
        // estimatedFee is 5 sat in makeUnpaidQuote, fee now is 100 sat
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 100 },
      }),
    });
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.initiateSend({ account, sendQuote: makeUnpaidQuote() }),
    ).rejects.toMatchObject({ code: 'fee_changed' });
  });

  it('throws DomainError(already_paid) when sendPayment throws an already-paid error', async () => {
    const account = makeAccount({
      prepareSendPayment: async () => ({
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
      }),
      sendPayment: async () => {
        throw new Error('Preimage request already exists');
      },
    });
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.initiateSend({ account, sendQuote: makeUnpaidQuote() }),
    ).rejects.toMatchObject({ code: 'already_paid' });
  });

  it('throws DomainError(insufficient_balance) when sendPayment throws an insufficient-balance error', async () => {
    const account = makeAccount({
      prepareSendPayment: async () => ({
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
      }),
      sendPayment: async () => {
        throw new Error('Insufficient balance');
      },
    });
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.initiateSend({ account, sendQuote: makeUnpaidQuote() }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
  });

  it('throws SdkError(spark_unexpected_response) when prepareSendPayment returns non-bolt11Invoice', async () => {
    const account = makeAccount({
      prepareSendPayment: async () => ({
        paymentMethod: { type: 'sparkAddress' },
      }),
    });
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.initiateSend({ account, sendQuote: makeUnpaidQuote() }),
    ).rejects.toBeInstanceOf(SdkError);
  });

  it('throws SdkError(spark_unexpected_response) when sendPayment returns no lightningSendDetails', async () => {
    const account = makeAccount({
      prepareSendPayment: async () => ({
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
      }),
      sendPayment: async () => ({
        payment: { id: 't1', fees: 2n },
        lightningSendDetails: undefined,
      }),
    });
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.initiateSend({ account, sendQuote: makeUnpaidQuote() }),
    ).rejects.toBeInstanceOf(SdkError);
  });
});

// ---------------------------------------------------------------------------
// Tests: complete
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.complete', () => {
  it('returns COMPLETED quote as-is (idempotent)', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    const completed = makeCompletedQuote();
    const result = await svc.complete(completed, 'preimage');
    expect(result).toBe(completed);
  });

  it('throws DomainError(invalid_state) for non-PENDING state', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    for (const quote of [makeUnpaidQuote(), makeFailedQuote()]) {
      await expect(svc.complete(quote, 'preimage')).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('calls repo.complete with the paymentPreimage', async () => {
    let capturedArgs:
      | Parameters<SparkSendQuoteRepository['complete']>[0]
      | undefined;
    const repo = makeFakeRepo({
      complete: async (args) => {
        capturedArgs = args;
        return makeCompletedQuote();
      },
    });
    const svc = new SparkSendQuoteService(repo);
    const pending = makePendingQuote();
    await svc.complete(pending, 'my-preimage');

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs?.paymentPreimage).toBe('my-preimage');
    expect(capturedArgs?.quote.id).toBe('q1');
  });
});

// ---------------------------------------------------------------------------
// Tests: fail
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.fail', () => {
  it('returns FAILED quote as-is (idempotent)', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    const failed = makeFailedQuote();
    const result = await svc.fail(failed, 'reason');
    expect(result).toBe(failed);
  });

  it('throws DomainError(invalid_state) for COMPLETED state', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.fail(makeCompletedQuote(), 'reason'),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.fail with quoteId and reason for UNPAID quote', async () => {
    let capturedId: string | undefined;
    let capturedReason: string | undefined;
    const repo = makeFakeRepo({
      fail: async (id, reason) => {
        capturedId = id;
        capturedReason = reason;
        return makeFailedQuote();
      },
    });
    const svc = new SparkSendQuoteService(repo);
    await svc.fail(makeUnpaidQuote(), 'timeout');

    expect(capturedId).toBe('q1');
    expect(capturedReason).toBe('timeout');
  });

  it('calls repo.fail for PENDING quote', async () => {
    let called = false;
    const repo = makeFakeRepo({
      fail: async () => {
        called = true;
        return makeFailedQuote();
      },
    });
    const svc = new SparkSendQuoteService(repo);
    await svc.fail(makePendingQuote(), 'network error');
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: createSendQuote
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.createSendQuote', () => {
  function makeLightningQuote(
    overrides: Partial<
      import('./spark-send-quote-service').SparkLightningQuote
    > = {},
  ): import('./spark-send-quote-service').SparkLightningQuote {
    const amountBtc = btc(250_000);
    const feeBtc = btc(5);
    return {
      paymentRequest: REAL_INVOICE,
      paymentHash: REAL_INVOICE_PAYMENT_HASH,
      amountRequested: amountBtc as Money,
      amountRequestedInBtc: amountBtc,
      amountToReceive: amountBtc as Money,
      estimatedLightningFee: feeBtc,
      estimatedTotalFee: feeBtc as Money,
      estimatedTotalAmount: amountBtc.add(feeBtc) as Money,
      paymentRequestIsAmountless: false,
      expiresAt: null,
      ...overrides,
    };
  }

  it('throws DomainError(expired) when the quote expiresAt is in the past', async () => {
    const svc = new SparkSendQuoteService(makeFakeRepo());
    const expiredQuote = makeLightningQuote({
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      svc.createSendQuote({
        userId: 'user-1',
        account: makeAccount(),
        quote: expiredQuote,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('throws DomainError(insufficient_balance) when balance < estimatedTotalAmount', async () => {
    // estimatedTotalAmount = 250_005 sat; account balance = 1 sat
    const svc = new SparkSendQuoteService(makeFakeRepo());
    await expect(
      svc.createSendQuote({
        userId: 'user-1',
        account: makeAccount({}, 1),
        quote: makeLightningQuote(),
      }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
  });

  it('calls repo.create and returns its result when balance is sufficient', async () => {
    let createCalled = false;
    const createdQuote = makeUnpaidQuote();
    const repo = makeFakeRepo({
      create: async () => {
        createCalled = true;
        return createdQuote;
      },
    });
    const svc = new SparkSendQuoteService(repo);
    const result = await svc.createSendQuote({
      userId: 'user-1',
      account: makeAccount({}, 1_000_000),
      quote: makeLightningQuote(),
    });
    expect(createCalled).toBe(true);
    expect(result).toBe(createdQuote);
  });
});

// ---------------------------------------------------------------------------
// Tests: get
// ---------------------------------------------------------------------------

describe('SparkSendQuoteService.get', () => {
  it('delegates to repo.get', async () => {
    const expected = makeUnpaidQuote();
    const svc = new SparkSendQuoteService(
      makeFakeRepo({ get: async () => expected }),
    );
    const result = await svc.get('q1');
    expect(result).toBe(expected);
  });

  it('returns null when not found', async () => {
    const svc = new SparkSendQuoteService(
      makeFakeRepo({ get: async () => null }),
    );
    expect(await svc.get('missing')).toBeNull();
  });
});
