import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btc(amount: number): Money<'BTC'> {
  return new Money({ amount, currency: 'BTC', unit: 'sat' }) as Money<'BTC'>;
}

function makeProof(amount: number): Proof {
  return {
    id: '009a1f293253e41e',
    amount,
    secret: `secret-${amount}`,
    C: 'C-value',
  };
}

/** Build a minimal SparkReceiveLightningQuote fixture. */
function makeLightningQuote(
  overrides: Partial<SparkReceiveLightningQuote> = {},
): SparkReceiveLightningQuote {
  return {
    id: 'rr-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    invoice: {
      paymentRequest: 'lnbc100n1...',
      paymentHash:
        '0001020304050607080900010203040506070809000102030405060708090102',
      amount: btc(100) as Money<'BTC'>,
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: '2024-01-01T01:00:00Z',
      memo: 'test',
    },
    status: 'pending' as never,
    ...overrides,
  };
}

const FAKE_ACCOUNT: SparkAccount = {
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
  balance: btc(10_000) as Money,
  wallet: {} as never,
} as unknown as SparkAccount;

// Base quote fields
const baseQuote = {
  id: 'q1',
  sparkId: 'rr-1',
  createdAt: '2024-01-01T00:00:00Z',
  expiresAt: '2020-01-01T00:00:00Z', // already expired (past)
  amount: btc(100) as Money,
  paymentRequest: 'lnbc100n1...',
  paymentHash:
    '0001020304050607080900010203040506070809000102030405060708090102',
  transactionId: 'txn-1',
  userId: 'user-1',
  accountId: 'acc-1',
  totalFee: btc(0) as Money,
  version: 1,
};

const UNPAID_LIGHTNING_QUOTE: SparkReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'UNPAID',
};

const PAID_QUOTE: SparkReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'PAID',
  paymentPreimage: 'preimage-abc',
  sparkTransferId: 'transfer-1',
};

const EXPIRED_QUOTE: SparkReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'EXPIRED',
};

const FAILED_QUOTE: SparkReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'FAILED',
  failureReason: 'payment failed',
};

const TOKEN_RECEIVE_DATA = {
  sourceMintUrl: 'https://source-mint.example.com',
  tokenAmount: btc(100) as Money,
  tokenProofs: [makeProof(100)],
  meltQuoteId: 'melt-quote-id',
  meltInitiated: false,
  cashuReceiveFee: btc(1) as Money,
  lightningFeeReserve: btc(2) as Money,
};

const UNPAID_CASHU_TOKEN_QUOTE: SparkReceiveQuote & { type: 'CASHU_TOKEN' } = {
  ...baseQuote,
  type: 'CASHU_TOKEN',
  state: 'UNPAID',
  tokenReceiveData: TOKEN_RECEIVE_DATA,
};

const UNPAID_CASHU_TOKEN_MELT_INITIATED: SparkReceiveQuote & {
  type: 'CASHU_TOKEN';
} = {
  ...UNPAID_CASHU_TOKEN_QUOTE,
  tokenReceiveData: { ...TOKEN_RECEIVE_DATA, meltInitiated: true },
};

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

type RepoOverrides = Partial<{
  create: SparkReceiveQuoteRepository['create'];
  complete: SparkReceiveQuoteRepository['complete'];
  expire: SparkReceiveQuoteRepository['expire'];
  fail: SparkReceiveQuoteRepository['fail'];
  markMeltInitiated: SparkReceiveQuoteRepository['markMeltInitiated'];
  get: SparkReceiveQuoteRepository['get'];
  getPending: SparkReceiveQuoteRepository['getPending'];
}>;

function makeFakeRepo(
  overrides: RepoOverrides = {},
): SparkReceiveQuoteRepository {
  const base = {
    create: async () => UNPAID_LIGHTNING_QUOTE,
    complete: async () => PAID_QUOTE,
    expire: async () => EXPIRED_QUOTE,
    fail: async () => {
      // no-op default
    },
    markMeltInitiated: async () =>
      UNPAID_CASHU_TOKEN_MELT_INITIATED as SparkReceiveQuote & {
        type: 'CASHU_TOKEN';
      },
    get: async () => null,
    getPending: async () => [],
  };
  return { ...base, ...overrides } as unknown as SparkReceiveQuoteRepository;
}

// ---------------------------------------------------------------------------
// Tests: createReceiveQuote (LIGHTNING)
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.createReceiveQuote LIGHTNING', () => {
  it('calls repo.create with receiveType LIGHTNING + invoice expiry + zero totalFee', async () => {
    let capturedArgs:
      | Parameters<SparkReceiveQuoteRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo({
      create: async (args) => {
        capturedArgs = args;
        return UNPAID_LIGHTNING_QUOTE;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    const lightningQuote = makeLightningQuote();

    const result = await svc.createReceiveQuote({
      userId: 'user-1',
      account: FAKE_ACCOUNT,
      lightningQuote,
      receiveType: 'LIGHTNING',
    });

    expect(result).toBe(UNPAID_LIGHTNING_QUOTE);
    if (!capturedArgs) throw new Error('repo.create was not called');
    expect(capturedArgs.receiveType).toBe('LIGHTNING');
    expect(capturedArgs.expiresAt).toBe(lightningQuote.invoice.expiresAt);
    expect(capturedArgs.totalFee.toNumber('sat')).toBe(0);
    expect(capturedArgs.paymentRequest).toBe(
      lightningQuote.invoice.paymentRequest,
    );
    expect(capturedArgs.paymentHash).toBe(lightningQuote.invoice.paymentHash);
    expect(capturedArgs.sparkId).toBe(lightningQuote.id);
    expect(capturedArgs.userId).toBe('user-1');
    expect(capturedArgs.accountId).toBe('acc-1');
  });
});

// ---------------------------------------------------------------------------
// Tests: createReceiveQuote (CASHU_TOKEN)
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.createReceiveQuote CASHU_TOKEN', () => {
  it('calls repo.create with receiveType CASHU_TOKEN + meltData populated + totalFee = cashuReceiveFee + lightningFeeReserve', async () => {
    let capturedArgs:
      | Parameters<SparkReceiveQuoteRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo({
      create: async (args) => {
        capturedArgs = args;
        return UNPAID_CASHU_TOKEN_QUOTE;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);

    const invoiceExpiresAt = '2024-01-01T01:00:00Z';
    const meltQuoteExpiresAt = '2024-01-01T00:30:00Z'; // earlier than invoice
    const cashuReceiveFee = btc(1) as Money;
    const lightningFeeReserve = btc(2) as Money;
    const tokenProofs = [makeProof(100)];
    const lightningQuote = makeLightningQuote({
      invoice: {
        paymentRequest: 'lnbc100n1...',
        paymentHash:
          '0001020304050607080900010203040506070809000102030405060708090102',
        amount: btc(100) as Money<'BTC'>,
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: invoiceExpiresAt,
      },
    });

    const result = await svc.createReceiveQuote({
      userId: 'user-1',
      account: FAKE_ACCOUNT,
      lightningQuote,
      receiveType: 'CASHU_TOKEN',
      tokenAmount: btc(100) as Money,
      sourceMintUrl: 'https://source-mint.example.com',
      tokenProofs,
      meltQuoteId: 'melt-quote-id',
      meltQuoteExpiresAt,
      cashuReceiveFee,
      lightningFeeReserve,
    });

    expect(result).toBe(UNPAID_CASHU_TOKEN_QUOTE);
    if (!capturedArgs) throw new Error('repo.create was not called');
    expect(capturedArgs.receiveType).toBe('CASHU_TOKEN');

    // totalFee = cashuReceiveFee + lightningFeeReserve = 1 + 2 = 3
    expect(capturedArgs.totalFee.toNumber('sat')).toBe(3);

    // expiresAt = min(invoice, meltQuote) = meltQuoteExpiresAt (earlier)
    const expectedExpiry = new Date(
      Math.min(
        new Date(invoiceExpiresAt).getTime(),
        new Date(meltQuoteExpiresAt).getTime(),
      ),
    ).toISOString();
    expect(capturedArgs.expiresAt).toBe(expectedExpiry);

    // meltData populated — narrow the discriminated union before accessing meltData
    if (capturedArgs.receiveType !== 'CASHU_TOKEN') {
      throw new Error('Expected CASHU_TOKEN');
    }
    expect(capturedArgs.meltData.tokenMintUrl).toBe(
      'https://source-mint.example.com',
    );
    expect(capturedArgs.meltData.meltQuoteId).toBe('melt-quote-id');
    expect(capturedArgs.meltData.tokenProofs).toBe(tokenProofs);
    expect(capturedArgs.meltData.cashuReceiveFee.toNumber('sat')).toBe(1);
    expect(capturedArgs.meltData.lightningFeeReserve.toNumber('sat')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: complete
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.complete', () => {
  it('returns PAID quote as-is (idempotent)', async () => {
    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    const result = await svc.complete(PAID_QUOTE, 'preimage', 'transfer-1');
    expect(result).toBe(PAID_QUOTE);
  });

  it('throws DomainError(invalid_state) when quote is not UNPAID', async () => {
    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    for (const quote of [EXPIRED_QUOTE, FAILED_QUOTE]) {
      await expect(
        svc.complete(quote, 'preimage', 'transfer-1'),
      ).rejects.toMatchObject({ code: 'invalid_state' });
    }
  });

  it('calls repo.complete with quote and sparkTransferId when UNPAID', async () => {
    let capturedArgs:
      | Parameters<SparkReceiveQuoteRepository['complete']>[0]
      | undefined;
    const repo = makeFakeRepo({
      complete: async (args) => {
        capturedArgs = args;
        return PAID_QUOTE;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);

    const result = await svc.complete(
      UNPAID_LIGHTNING_QUOTE,
      'my-preimage',
      'transfer-xyz',
    );

    expect(result).toBe(PAID_QUOTE);
    if (!capturedArgs) throw new Error('repo.complete was not called');
    expect(capturedArgs.quote.id).toBe('q1');
    expect(capturedArgs.paymentPreimage).toBe('my-preimage');
    expect(capturedArgs.sparkTransferId).toBe('transfer-xyz');
  });
});

// ---------------------------------------------------------------------------
// Tests: expire
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.expire', () => {
  it('is a no-op when already EXPIRED', async () => {
    let expireCalled = false;
    const repo = makeFakeRepo({
      expire: async () => {
        expireCalled = true;
        return EXPIRED_QUOTE;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    await svc.expire(EXPIRED_QUOTE);
    expect(expireCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when not UNPAID', async () => {
    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    for (const quote of [PAID_QUOTE, FAILED_QUOTE]) {
      await expect(svc.expire(quote)).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('throws DomainError(invalid_state) when UNPAID but not yet expired', async () => {
    const notExpiredQuote: SparkReceiveQuote = {
      ...UNPAID_LIGHTNING_QUOTE,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    await expect(svc.expire(notExpiredQuote)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.expire when UNPAID and past expiry', async () => {
    let capturedId: string | undefined;
    const repo = makeFakeRepo({
      expire: async (id) => {
        capturedId = id;
        return EXPIRED_QUOTE;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    // baseQuote.expiresAt is '2020-01-01T00:00:00Z' — already past
    await svc.expire(UNPAID_LIGHTNING_QUOTE);
    expect(capturedId).toBe('q1');
  });
});

// ---------------------------------------------------------------------------
// Tests: fail
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.fail', () => {
  it('is a no-op when already FAILED', async () => {
    let failCalled = false;
    const repo = makeFakeRepo({
      fail: async () => {
        failCalled = true;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    await svc.fail(FAILED_QUOTE, 'whatever');
    expect(failCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when not UNPAID', async () => {
    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    for (const quote of [PAID_QUOTE, EXPIRED_QUOTE]) {
      await expect(svc.fail(quote, 'reason')).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('calls repo.fail with id and reason when UNPAID', async () => {
    let capturedArgs: { id: string; reason: string } | undefined;
    const repo = makeFakeRepo({
      fail: async (args) => {
        capturedArgs = args;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    await svc.fail(UNPAID_LIGHTNING_QUOTE, 'timeout');
    expect(capturedArgs).toEqual({ id: 'q1', reason: 'timeout' });
  });
});

// ---------------------------------------------------------------------------
// Tests: markMeltInitiated
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.markMeltInitiated', () => {
  it('is a no-op when meltInitiated is already true', async () => {
    let markCalled = false;
    const repo = makeFakeRepo({
      markMeltInitiated: async () => {
        markCalled = true;
        return UNPAID_CASHU_TOKEN_MELT_INITIATED;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    const result = await svc.markMeltInitiated(
      UNPAID_CASHU_TOKEN_MELT_INITIATED,
    );
    expect(result).toBe(UNPAID_CASHU_TOKEN_MELT_INITIATED);
    expect(markCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when state is not UNPAID', async () => {
    const paidCashuToken: SparkReceiveQuote & { type: 'CASHU_TOKEN' } = {
      ...UNPAID_CASHU_TOKEN_QUOTE,
      state: 'PAID',
      paymentPreimage: 'preimage',
      sparkTransferId: 'transfer-1',
    } as SparkReceiveQuote & { type: 'CASHU_TOKEN' };

    const svc = new SparkReceiveQuoteService(makeFakeRepo());
    await expect(svc.markMeltInitiated(paidCashuToken)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.markMeltInitiated and returns updated quote when UNPAID + meltInitiated false', async () => {
    let capturedQuote:
      | (SparkReceiveQuote & { type: 'CASHU_TOKEN' })
      | undefined;
    const repo = makeFakeRepo({
      markMeltInitiated: async (q) => {
        capturedQuote = q;
        return UNPAID_CASHU_TOKEN_MELT_INITIATED;
      },
    });
    const svc = new SparkReceiveQuoteService(repo);
    const result = await svc.markMeltInitiated(UNPAID_CASHU_TOKEN_QUOTE);
    expect(result).toBe(UNPAID_CASHU_TOKEN_MELT_INITIATED);
    expect(capturedQuote).toBe(UNPAID_CASHU_TOKEN_QUOTE);
  });
});

// ---------------------------------------------------------------------------
// Tests: get
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteService.get', () => {
  it('delegates to repo.get', async () => {
    const svc = new SparkReceiveQuoteService(
      makeFakeRepo({ get: async () => UNPAID_LIGHTNING_QUOTE }),
    );
    expect(await svc.get('q1')).toBe(UNPAID_LIGHTNING_QUOTE);
  });

  it('returns null when not found', async () => {
    const svc = new SparkReceiveQuoteService(
      makeFakeRepo({ get: async () => null }),
    );
    expect(await svc.get('missing')).toBeNull();
  });
});
