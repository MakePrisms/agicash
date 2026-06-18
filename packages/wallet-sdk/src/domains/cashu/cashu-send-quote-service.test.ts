import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  type Proof,
} from '@cashu/cashu-ts';
import type { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import type { CashuAccount, CashuProof } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import { CashuSendQuoteService } from './cashu-send-quote-service';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeDomainProof(overrides: Partial<CashuProof> = {}): CashuProof {
  return {
    id: `proof-${Math.random()}`,
    accountId: 'acc-1',
    userId: 'user-1',
    keysetId: '009a1f293253e41e',
    amount: 64,
    secret: `secret-${Math.random()}`,
    unblindedSignature: 'C-value',
    publicKeyY: 'Y-value',
    dleq: undefined,
    witness: undefined,
    state: 'UNSPENT',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function btcMoney(
  amount: number,
  unit: 'sat' | 'msat' = 'sat',
): Money<Currency> {
  return new Money({
    amount,
    currency: 'BTC',
    unit,
  }) as unknown as Money<Currency>;
}

function btcMoneyBtc(
  amount: number,
  unit: 'sat' | 'msat' = 'sat',
): Money<'BTC'> {
  return new Money({
    amount,
    currency: 'BTC',
    unit,
  }) as unknown as Money<'BTC'>;
}

function makeMeltQuote(
  overrides: Partial<MeltQuoteBolt11Response> = {},
): MeltQuoteBolt11Response {
  return {
    quote: 'melt-quote-id',
    amount: 100,
    fee_reserve: 10,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    state: MeltQuoteState.UNPAID,
    unit: 'sat',
    request: '',
    payment_preimage: null,
    ...overrides,
  };
}

const fakeKeyset = {
  id: '009a1f293253e41e',
  unit: 'sat',
  active: true,
  keys: {
    1: 'pubkey-1',
    2: 'pubkey-2',
    4: 'pubkey-4',
    8: 'pubkey-8',
    16: 'pubkey-16',
    32: 'pubkey-32',
    64: 'pubkey-64',
    128: 'pubkey-128',
  },
};

type FakeWalletOptions = {
  selectProofsResult?: { send: Proof[]; keep: Proof[] };
  getFeesForProofsResult?: number;
  meltProofsIdempotentResult?: MeltQuoteBolt11Response;
  checkMeltQuoteResult?: { state: MeltQuoteState };
  keysetId?: string;
};

function makeFakeWallet(options: FakeWalletOptions = {}) {
  const {
    selectProofsResult,
    getFeesForProofsResult = 0,
    meltProofsIdempotentResult,
    checkMeltQuoteResult = { state: MeltQuoteState.UNPAID },
    keysetId = '009a1f293253e41e',
  } = options;

  return {
    keysetId,
    seed: new Uint8Array(64),
    keyChain: {
      ensureKeysetKeys: async (_id: string) => undefined,
    },
    getKeyset: (_id?: string) => fakeKeyset,
    getFeesForProofs: (_proofs: Proof[]) => getFeesForProofsResult,
    selectProofsToSend: (
      proofs: Proof[],
      _amount: number,
      _includeFees?: boolean,
    ) => selectProofsResult ?? { send: proofs, keep: [] },
    meltProofsIdempotent: async (
      _meltQuote: unknown,
      _proofs: Proof[],
      _config?: unknown,
      _outputType?: unknown,
    ) =>
      meltProofsIdempotentResult ??
      ({
        state: MeltQuoteState.PAID,
        quote: 'quote-id',
        amount: 100,
        fee_reserve: 10,
        expiry: 9999999999,
        payment_preimage: 'preimage',
      } as unknown as MeltQuoteBolt11Response),
    checkMeltQuoteBolt11: async (_quoteId: string) => checkMeltQuoteResult,
  };
}

function makeFakeAccount(
  wallet: ReturnType<typeof makeFakeWallet>,
  proofs: CashuProof[] = [],
): CashuAccount {
  return {
    id: 'acc-1',
    name: 'Test Account',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2024-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://mint.example.com',
    isTestMint: false,
    keysetCounters: { '009a1f293253e41e': 5 },
    proofs,
    wallet: wallet as unknown as CashuAccount['wallet'],
  };
}

function makeUnpaidQuote(
  overrides: Partial<CashuSendQuote> = {},
): CashuSendQuote {
  const base = {
    id: 'quote-1',
    createdAt: '2024-01-01T00:00:00Z',
    // expires 1 hour in the past
    expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    userId: 'user-1',
    accountId: 'acc-1',
    paymentRequest: 'lnbc100n1pjxx',
    paymentHash: 'hash-abc',
    amountRequested: btcMoney(100),
    amountRequestedInMsat: 100_000,
    amountReceived: btcMoney(100),
    lightningFeeReserve: btcMoney(10),
    cashuFee: btcMoney(0),
    quoteId: 'melt-quote-id',
    proofs: [makeDomainProof({ amount: 110 })],
    amountReserved: btcMoney(110),
    keysetId: '009a1f293253e41e',
    keysetCounter: 5,
    numberOfChangeOutputs: 0,
    transactionId: 'txn-1',
    version: 1,
    state: 'UNPAID' as const,
    ...overrides,
  };
  return base as CashuSendQuote;
}

function makePendingQuote(
  overrides: Partial<CashuSendQuote> = {},
): CashuSendQuote {
  return makeUnpaidQuote({ state: 'PENDING', ...overrides }) as CashuSendQuote;
}

function makePaidQuote(
  overrides: Partial<CashuSendQuote> = {},
): CashuSendQuote {
  return {
    ...makeUnpaidQuote(),
    state: 'PAID',
    paymentPreimage: 'preimage',
    lightningFee: btcMoney(5),
    amountSpent: btcMoney(105),
    totalFee: btcMoney(5),
    ...overrides,
  } as CashuSendQuote;
}

function makeFailedQuote(
  overrides: Partial<CashuSendQuote> = {},
): CashuSendQuote {
  return {
    ...makeUnpaidQuote(),
    state: 'FAILED',
    failureReason: 'some reason',
    ...overrides,
  } as CashuSendQuote;
}

function makeExpiredQuote(
  overrides: Partial<CashuSendQuote> = {},
): CashuSendQuote {
  return makeUnpaidQuote({ state: 'EXPIRED', ...overrides }) as CashuSendQuote;
}

function makeFakeRepo(
  options: {
    markAsPendingResult?: CashuSendQuote;
    expireResult?: undefined;
    failResult?: CashuSendQuote;
    completeResult?: CashuSendQuote;
    createResult?: CashuSendQuote;
  } = {},
): CashuSendQuoteRepository {
  const pendingQuote = makePendingQuote();
  const failedQuote = makeFailedQuote();

  return {
    create: async () => options.createResult ?? makeUnpaidQuote(),
    complete: async () => options.completeResult ?? makePaidQuote(),
    expire: async (_id: string) => options.expireResult,
    fail: async () => options.failResult ?? failedQuote,
    markAsPending: async () => options.markAsPendingResult ?? pendingQuote,
    get: async () => null,
    getByTransactionId: async () => null,
    getUnresolved: async () => [],
  } as unknown as CashuSendQuoteRepository;
}

// ---------------------------------------------------------------------------
// Tests: markSendQuoteAsPending
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService.markSendQuoteAsPending', () => {
  it('is a no-op when quote is already PENDING', async () => {
    const repo = makeFakeRepo();
    let markCalled = false;
    repo.markAsPending = async () => {
      markCalled = true;
      return makePendingQuote();
    };
    const service = new CashuSendQuoteService(repo);
    const pendingQuote = makePendingQuote();

    const result = await service.markSendQuoteAsPending(pendingQuote);

    expect(result).toBe(pendingQuote);
    expect(markCalled).toBe(false);
  });

  it('calls repo.markAsPending when state is UNPAID', async () => {
    const expectedPending = makePendingQuote();
    let capturedId: string | undefined;
    const repo = makeFakeRepo();
    repo.markAsPending = async (id: string) => {
      capturedId = id;
      return expectedPending;
    };

    const service = new CashuSendQuoteService(repo);
    const unpaidQuote = makeUnpaidQuote();
    const result = await service.markSendQuoteAsPending(unpaidQuote);

    expect(result).toBe(expectedPending);
    expect(capturedId).toBe('quote-1');
  });

  it('throws DomainError(invalid_state) for non-UNPAID, non-PENDING states', async () => {
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    for (const state of ['PAID', 'FAILED', 'EXPIRED'] as const) {
      const quote = makeUnpaidQuote({ state } as Partial<CashuSendQuote>);
      await expect(service.markSendQuoteAsPending(quote)).rejects.toMatchObject(
        {
          code: 'invalid_state',
        },
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: expireSendQuote
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService.expireSendQuote', () => {
  it('is a no-op when quote is already EXPIRED', async () => {
    const repo = makeFakeRepo();
    let expireCalled = false;
    repo.expire = async () => {
      expireCalled = true;
    };
    const service = new CashuSendQuoteService(repo);
    const expiredQuote = makeExpiredQuote();

    await service.expireSendQuote(expiredQuote);
    expect(expireCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when state is not UNPAID', async () => {
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    for (const state of ['PENDING', 'PAID', 'FAILED'] as const) {
      const quote = makeUnpaidQuote({ state } as Partial<CashuSendQuote>);
      await expect(service.expireSendQuote(quote)).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('throws DomainError(not_expired) when quote has not expired yet', async () => {
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);
    // expiresAt in the future
    const notExpiredQuote = makeUnpaidQuote({
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    await expect(
      service.expireSendQuote(notExpiredQuote),
    ).rejects.toMatchObject({
      code: 'not_expired',
    });
  });

  it('calls repo.expire when UNPAID and past expiresAt', async () => {
    let capturedId: string | undefined;
    const repo = makeFakeRepo();
    repo.expire = async (id: string) => {
      capturedId = id;
    };

    const service = new CashuSendQuoteService(repo);
    // expiresAt in the past (default in makeUnpaidQuote)
    const expiredUnpaidQuote = makeUnpaidQuote();

    await service.expireSendQuote(expiredUnpaidQuote);
    expect(capturedId).toBe('quote-1');
  });
});

// ---------------------------------------------------------------------------
// Tests: failSendQuote
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService.failSendQuote', () => {
  it('is a no-op when quote is already FAILED', async () => {
    const repo = makeFakeRepo();
    let failCalled = false;
    repo.fail = async () => {
      failCalled = true;
      return makeFailedQuote();
    };
    const service = new CashuSendQuoteService(repo);
    const failedQuote = makeFailedQuote();

    const result = await service.failSendQuote(
      makeFakeAccount(makeFakeWallet()) as CashuAccount,
      failedQuote,
      'reason',
    );

    expect(result).toBe(failedQuote);
    expect(failCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) for states other than PENDING/UNPAID', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    for (const state of ['PAID', 'EXPIRED'] as const) {
      const quote = makeUnpaidQuote({ state } as Partial<CashuSendQuote>);
      await expect(
        service.failSendQuote(account, quote, 'reason'),
      ).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('throws DomainError(account_mismatch) when account does not match', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    account.id = 'different-account';
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.failSendQuote(account, makeUnpaidQuote(), 'reason'),
    ).rejects.toMatchObject({ code: 'account_mismatch' });
  });

  it('throws DomainError(invalid_state) when melt quote is PAID (not UNPAID)', async () => {
    const wallet = makeFakeWallet({
      checkMeltQuoteResult: { state: MeltQuoteState.PAID },
    });
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.failSendQuote(account, makeUnpaidQuote(), 'reason'),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('throws DomainError(invalid_state) when melt quote is PENDING', async () => {
    const wallet = makeFakeWallet({
      checkMeltQuoteResult: { state: MeltQuoteState.PENDING },
    });
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.failSendQuote(account, makeUnpaidQuote(), 'reason'),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls repo.fail and returns result when melt quote is UNPAID', async () => {
    const wallet = makeFakeWallet({
      checkMeltQuoteResult: { state: MeltQuoteState.UNPAID },
    });
    const account = makeFakeAccount(wallet);

    const expectedFailed = makeFailedQuote({
      failureReason: 'payment failed',
    } as Partial<CashuSendQuote>);
    let capturedArgs: { id: string; reason: string } | undefined;
    const repo = makeFakeRepo();
    repo.fail = async (args) => {
      capturedArgs = args;
      return expectedFailed;
    };

    const service = new CashuSendQuoteService(repo);
    const result = await service.failSendQuote(
      account,
      makeUnpaidQuote(),
      'payment failed',
    );

    expect(result).toBe(expectedFailed);
    expect(capturedArgs).toEqual({ id: 'quote-1', reason: 'payment failed' });
  });
});

// ---------------------------------------------------------------------------
// Tests: selectProofs (via createSendQuote)
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService selectProofs (via createSendQuote)', () => {
  it('throws DomainError(insufficient_balance) when proofs sum < total amount + fee', async () => {
    // proofs sum = 100, fee = 5, melt amount = 100, fee_reserve = 10
    // totalAmountToSend = 100 + 10 + 5 = 115 > 100
    const proof = makeDomainProof({ amount: 100, secret: 'my-secret' });
    const fakeProof: Proof = {
      id: '009a1f293253e41e',
      amount: 100,
      secret: 'my-secret',
      C: 'C-value',
    };
    const wallet = makeFakeWallet({
      selectProofsResult: { send: [fakeProof], keep: [] },
      getFeesForProofsResult: 5,
    });
    const account = makeFakeAccount(wallet, [proof]);

    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    const meltQuote = makeMeltQuote({
      quote: 'melt-q',
      amount: 100,
      fee_reserve: 10,
    });

    await expect(
      service.createSendQuote({
        userId: 'user-1',
        account,
        sendQuote: {
          paymentRequest: 'lnbc100n1pjxx',
          amountRequested: btcMoney(100),
          amountRequestedInBtc: btcMoneyBtc(100_000, 'msat'),
          meltQuote,
        },
      }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
  });

  it('throws DomainError(invalid_state) when selected proof secret not found in account (Proof not found)', async () => {
    const proof1 = makeDomainProof({ amount: 120, secret: 'my-secret-1' });
    // wallet returns a proof with a secret that is NOT in account.proofs
    const fakeMissingSecretProof: Proof = {
      id: '009a1f293253e41e',
      amount: 120,
      secret: 'not-in-account',
      C: 'C-value',
    };
    const wallet = makeFakeWallet({
      selectProofsResult: { send: [fakeMissingSecretProof], keep: [] },
      getFeesForProofsResult: 0,
    });
    const account = makeFakeAccount(wallet, [proof1]);

    const testMeltQuote = makeMeltQuote({
      quote: 'melt-q',
      amount: 100,
      fee_reserve: 10,
    });
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.createSendQuote({
        userId: 'user-1',
        account,
        sendQuote: {
          paymentRequest: 'lnbc100n1pjxx',
          amountRequested: btcMoney(100),
          amountRequestedInBtc: btcMoneyBtc(100_000, 'msat'),
          meltQuote: testMeltQuote,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

// ---------------------------------------------------------------------------
// Tests: createSendQuote – purpose forwarding
// ---------------------------------------------------------------------------

// A real BOLT11 invoice (testnet) used to satisfy decodeBolt11 inside createSendQuote.
const REAL_BOLT11 =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

describe('CashuSendQuoteService.createSendQuote', () => {
  it('forwards purpose to repo.create', async () => {
    const proof = makeDomainProof({ amount: 300_000, secret: 'my-secret' });
    const fakeProof = {
      id: '009a1f293253e41e',
      amount: 300_000,
      secret: 'my-secret',
      C: 'C-value',
    };
    const wallet = makeFakeWallet({
      selectProofsResult: { send: [fakeProof], keep: [] },
      getFeesForProofsResult: 0,
    });
    const account = makeFakeAccount(wallet, [proof]);

    let capturedCreate:
      | Parameters<CashuSendQuoteRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo();
    repo.create = async (args) => {
      capturedCreate = args;
      return makeUnpaidQuote();
    };

    const service = new CashuSendQuoteService(repo);
    // melt amount 250_000 sat (matches REAL_BOLT11 amount of 2500u = 250_000 sat)
    const meltQuote = makeMeltQuote({
      quote: 'melt-q',
      amount: 250_000,
      fee_reserve: 1_000,
    });

    await service.createSendQuote({
      userId: 'user-1',
      account,
      sendQuote: {
        paymentRequest: REAL_BOLT11,
        amountRequested: btcMoney(250_000),
        amountRequestedInBtc: btcMoneyBtc(250_000_000, 'msat'),
        meltQuote,
      },
      purpose: 'TRANSFER',
    });

    expect(capturedCreate).toBeDefined();
    expect(capturedCreate?.purpose).toBe('TRANSFER');
  });
});

// ---------------------------------------------------------------------------
// Tests: initiateSend
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService.initiateSend', () => {
  it('throws DomainError(account_mismatch) when account id differs', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    account.id = 'different-acc';
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.initiateSend(account, makeUnpaidQuote(), {
        quote: 'melt-quote-id',
        amount: 100,
      }),
    ).rejects.toMatchObject({ code: 'account_mismatch' });
  });

  it('throws DomainError(quote_mismatch) when melt quote id differs', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.initiateSend(account, makeUnpaidQuote(), {
        quote: 'wrong-melt-quote-id',
        amount: 100,
      }),
    ).rejects.toMatchObject({ code: 'quote_mismatch' });
  });

  it('throws DomainError(invalid_state) when quote is not UNPAID', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.initiateSend(account, makePendingQuote(), {
        quote: 'melt-quote-id',
        amount: 100,
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls wallet.meltProofsIdempotent and returns the result', async () => {
    const expectedResponse = makeMeltQuote({
      quote: 'melt-quote-id',
      state: MeltQuoteState.PAID,
      payment_preimage: 'my-preimage',
    });
    let capturedArgs:
      | {
          meltQuote: unknown;
          proofs: Proof[];
          config: unknown;
          outputType: unknown;
        }
      | undefined;

    const wallet = makeFakeWallet({
      meltProofsIdempotentResult: expectedResponse,
    });
    wallet.meltProofsIdempotent = async (
      meltQuote,
      proofs,
      config,
      outputType,
    ) => {
      capturedArgs = { meltQuote, proofs, config, outputType };
      return expectedResponse;
    };

    const account = makeFakeAccount(wallet, [makeDomainProof({ amount: 110 })]);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    const unpaidQuote = makeUnpaidQuote({
      proofs: [makeDomainProof({ amount: 110, secret: 'secret-val' })],
      quoteId: 'melt-quote-id',
      keysetId: '009a1f293253e41e',
      keysetCounter: 5,
    });

    const result = await service.initiateSend(account, unpaidQuote, {
      quote: 'melt-quote-id',
      amount: 100,
    });

    expect(result).toBe(expectedResponse);
    expect(capturedArgs).toBeDefined();
    expect((capturedArgs?.config as { keysetId: string }).keysetId).toBe(
      '009a1f293253e41e',
    );
    expect(
      (capturedArgs?.outputType as { type: string; counter: number }).type,
    ).toBe('deterministic');
    expect(
      (capturedArgs?.outputType as { type: string; counter: number }).counter,
    ).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: completeSendQuote
// ---------------------------------------------------------------------------

describe('CashuSendQuoteService.completeSendQuote', () => {
  it('is a no-op when quote is already PAID', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    let completeCalled = false;
    repo.complete = async () => {
      completeCalled = true;
      return makePaidQuote();
    };
    const service = new CashuSendQuoteService(repo);
    const paidQuote = makePaidQuote();

    const result = await service.completeSendQuote(
      account,
      paidQuote,
      makeMeltQuote({
        quote: 'melt-quote-id',
        state: MeltQuoteState.PAID,
        payment_preimage: 'preimage',
      }),
    );

    expect(result).toBe(paidQuote);
    expect(completeCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) for non-PENDING/non-UNPAID states', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    for (const state of ['EXPIRED', 'FAILED'] as const) {
      const quote = makeUnpaidQuote({ state } as Partial<CashuSendQuote>);
      await expect(
        service.completeSendQuote(
          account,
          quote,
          makeMeltQuote({ quote: 'melt-quote-id', state: MeltQuoteState.PAID }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_state' });
    }
  });

  it('throws DomainError(account_mismatch) when account id differs', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    account.id = 'wrong-acc';
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.completeSendQuote(
        account,
        makeUnpaidQuote(),
        makeMeltQuote({ quote: 'melt-quote-id', state: MeltQuoteState.PAID }),
      ),
    ).rejects.toMatchObject({ code: 'account_mismatch' });
  });

  it('throws DomainError(quote_mismatch) when melt quote id differs', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.completeSendQuote(
        account,
        makeUnpaidQuote(),
        makeMeltQuote({
          quote: 'wrong-melt-quote-id',
          state: MeltQuoteState.PAID,
        }),
      ),
    ).rejects.toMatchObject({ code: 'quote_mismatch' });
  });

  it('throws DomainError(invalid_state) when melt quote state is not PAID', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendQuoteService(repo);

    await expect(
      service.completeSendQuote(
        account,
        makeUnpaidQuote(),
        makeMeltQuote({ quote: 'melt-quote-id', state: MeltQuoteState.UNPAID }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls repo.complete with correct amountSpent when numberOfChangeOutputs=0', async () => {
    // sendQuote.proofs sum = 110, changeProofs = [] → amountSpent = 110
    const proof = makeDomainProof({ amount: 110, secret: 's1' });
    const sendQuote = makeUnpaidQuote({
      proofs: [proof],
      numberOfChangeOutputs: 0,
      keysetId: '009a1f293253e41e',
      keysetCounter: 5,
    });

    let capturedComplete:
      | Parameters<CashuSendQuoteRepository['complete']>[0]
      | undefined;
    const expectedPaid = makePaidQuote();
    const repo = makeFakeRepo();
    repo.complete = async (args) => {
      capturedComplete = args;
      return expectedPaid;
    };

    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet, [proof]);

    const service = new CashuSendQuoteService(repo);
    const meltQuote = makeMeltQuote({
      quote: 'melt-quote-id',
      state: MeltQuoteState.PAID,
      payment_preimage: 'my-preimage',
      change: [],
    });

    const result = await service.completeSendQuote(
      account,
      sendQuote,
      meltQuote,
    );

    expect(result).toBe(expectedPaid);
    expect(capturedComplete).toBeDefined();
    expect(capturedComplete?.paymentPreimage).toBe('my-preimage');
    // amountSpent = sum(proofs) - sum(changeProofs) = 110 - 0 = 110
    expect(capturedComplete?.amountSpent.toNumber('sat')).toBe(110);
    expect(capturedComplete?.changeProofs).toEqual([]);
  });
});
