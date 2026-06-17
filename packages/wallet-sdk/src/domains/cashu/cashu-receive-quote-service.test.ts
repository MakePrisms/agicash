import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { MintQuoteState, type Proof } from '@cashu/cashu-ts';
import type { CashuCryptography } from '../../internal/connections/cashu-crypto';
import type { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

// Derived from seed = Uint8Array(64).fill(1) at path m/129372'/0'/0'
// using HDKey.fromMasterSeed(seed).derive(path).publicExtendedKey
const FAKE_XPUB =
  'xpub6C3NoNvapesbJUparkRBHevx9Sqq9bh4uTxfHNXyjRxLQAewJkYoo4RJEhg581gfyQm2qgChbxauRftkH2LddEMBeqxtoUDcL9FetWaakdv';
const FAKE_PRIVATE_KEY =
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

function btcMoney(sats: number): Money<Currency> {
  return new Money({
    amount: sats,
    currency: 'BTC',
    unit: 'sat',
  }) as unknown as Money<Currency>;
}

function makeProof(amount: number): Proof {
  return {
    id: '009a1f293253e41e',
    amount,
    secret: `secret-${amount}-${Math.random()}`,
    C: 'C-value',
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

function makeFakeCryptography(): CashuCryptography {
  return {
    getSeed: async () => new Uint8Array(64),
    getXpub: async (_path?: string) => FAKE_XPUB,
    getPrivateKey: async (_path?: string) => FAKE_PRIVATE_KEY,
  };
}

function makeFakeWallet(
  options: {
    mintBolt11Result?: Proof[] | (() => Promise<Proof[]>);
    restoreResult?: Proof[];
    keysetId?: string;
  } = {},
) {
  const {
    mintBolt11Result = [makeProof(100)],
    restoreResult = [makeProof(100)],
    keysetId = '009a1f293253e41e',
  } = options;

  return {
    unit: 'sat',
    keysetId,
    seed: new Uint8Array(64),
    keyChain: {
      ensureKeysetKeys: async (_id: string) => {},
    },
    getKeyset: (_id?: string) => fakeKeyset,
    ops: {
      mintBolt11: (_amount: number, _quote: unknown) => ({
        keyset: (_id: string) => ({
          privkey: (_key: string) => ({
            asCustom: (_data: unknown) => ({
              run: async (): Promise<Proof[]> => {
                if (typeof mintBolt11Result === 'function') {
                  return mintBolt11Result();
                }
                return mintBolt11Result as Proof[];
              },
            }),
          }),
        }),
      }),
    },
    restore: async (
      _start: number,
      _count: number,
      _config?: { keysetId?: string },
    ) => ({
      proofs: restoreResult,
    }),
  };
}

function makeFakeAccount(
  wallet: ReturnType<typeof makeFakeWallet>,
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
    keysetCounters: {},
    proofs: [],
    wallet: wallet as unknown as CashuAccount['wallet'],
  };
}

// Base quote fields shared across test fixtures
const baseQuote = {
  id: 'quote-1',
  userId: 'user-1',
  accountId: 'acc-1',
  quoteId: 'mint-quote-id-abc',
  amount: btcMoney(100),
  createdAt: '2024-01-01T00:00:00Z',
  expiresAt: '2020-01-01T00:00:00Z', // already expired
  paymentRequest: 'lnbc...',
  paymentHash: 'payment-hash-abc',
  lockingDerivationPath: "m/129372'/0'/0'/42",
  transactionId: 'txn-1',
  totalFee: btcMoney(0),
  version: 1,
};

const unpaidLightningQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'UNPAID',
};

const paidLightningQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'PAID',
  keysetId: '009a1f293253e41e',
  keysetCounter: 0,
  outputAmounts: [64, 32, 4],
};

const completedLightningQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'COMPLETED',
  keysetId: '009a1f293253e41e',
  keysetCounter: 0,
  outputAmounts: [64, 32, 4],
};

const expiredLightningQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'EXPIRED',
};

const failedLightningQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'LIGHTNING',
  state: 'FAILED',
  failureReason: 'payment failed',
};

const unpaidCashuTokenQuote: CashuReceiveQuote = {
  ...baseQuote,
  type: 'CASHU_TOKEN',
  state: 'UNPAID',
  tokenReceiveData: {
    sourceMintUrl: 'https://source-mint.example.com',
    tokenAmount: btcMoney(100),
    tokenProofs: [makeProof(100)],
    meltQuoteId: 'melt-quote-id',
    meltInitiated: false,
    cashuReceiveFee: btcMoney(1),
    lightningFeeReserve: btcMoney(2),
  },
};

const unpaidCashuTokenQuoteMeltInitiated: CashuReceiveQuote = {
  ...unpaidCashuTokenQuote,
  tokenReceiveData: {
    ...unpaidCashuTokenQuote.tokenReceiveData,
    meltInitiated: true,
  },
};

// Fake repo that records calls
function makeFakeRepo(
  options: {
    createResult?: CashuReceiveQuote;
    expireResult?: void;
    failResult?: void;
    markMeltInitiatedResult?: CashuReceiveQuote & { type: 'CASHU_TOKEN' };
    processPaymentResult?: { quote: CashuReceiveQuote; account: CashuAccount };
    completeReceiveResult?: {
      quote: CashuReceiveQuote;
      account: CashuAccount;
      addedProofs: string[];
    };
  } = {},
): CashuReceiveQuoteRepository {
  const fakeWallet = makeFakeWallet();
  const fakeAccount = makeFakeAccount(fakeWallet);

  return {
    create: async () => options.createResult ?? unpaidLightningQuote,
    expire: async () => options.expireResult,
    fail: async () => options.failResult,
    markMeltInitiated: async () =>
      (options.markMeltInitiatedResult ??
        unpaidCashuTokenQuoteMeltInitiated) as CashuReceiveQuote & {
        type: 'CASHU_TOKEN';
      },
    processPayment: async () =>
      options.processPaymentResult ?? {
        quote: paidLightningQuote,
        account: fakeAccount,
      },
    completeReceive: async () =>
      options.completeReceiveResult ?? {
        quote: completedLightningQuote,
        account: fakeAccount,
        addedProofs: ['proof-id-1'],
      },
    get: async () => null,
    getByTransactionId: async () => null,
    getPending: async () => [],
  } as unknown as CashuReceiveQuoteRepository;
}

// ---------------------------------------------------------------------------
// Tests: expire
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteService.expire', () => {
  it('is a no-op when already EXPIRED', async () => {
    const repo = makeFakeRepo();
    let expireCalled = false;
    (repo as unknown as { expire: (id: string) => Promise<void> }).expire =
      async () => {
        expireCalled = true;
      };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await service.expire(expiredLightningQuote);

    expect(expireCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when quote is not UNPAID', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await expect(service.expire(failedLightningQuote)).rejects.toMatchObject({
      code: 'invalid_state',
    });

    await expect(service.expire(paidLightningQuote)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('throws DomainError(not_expired) when quote has not expired yet', async () => {
    const notExpiredQuote: CashuReceiveQuote = {
      ...unpaidLightningQuote,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await expect(service.expire(notExpiredQuote)).rejects.toMatchObject({
      code: 'not_expired',
    });
  });

  it('calls repo.expire when UNPAID and past expiry', async () => {
    let capturedId: string | undefined;
    const repo = makeFakeRepo();
    (repo as unknown as { expire: (id: string) => Promise<void> }).expire =
      async (id: string) => {
        capturedId = id;
      };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    // baseQuote.expiresAt is '2020-01-01T00:00:00Z' — already past
    await service.expire(unpaidLightningQuote);

    expect(capturedId).toBe(unpaidLightningQuote.id);
  });
});

// ---------------------------------------------------------------------------
// Tests: fail
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteService.fail', () => {
  it('is a no-op when already FAILED', async () => {
    const repo = makeFakeRepo();
    let failCalled = false;
    (
      repo as unknown as {
        fail: (args: { id: string; reason: string }) => Promise<void>;
      }
    ).fail = async () => {
      failCalled = true;
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await service.fail(failedLightningQuote, 'whatever');

    expect(failCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when quote is not UNPAID', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await expect(
      service.fail(paidLightningQuote, 'reason'),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    await expect(
      service.fail(completedLightningQuote, 'reason'),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls repo.fail with id and reason when UNPAID', async () => {
    let capturedArgs: { id: string; reason: string } | undefined;
    const repo = makeFakeRepo();
    (
      repo as unknown as {
        fail: (args: { id: string; reason: string }) => Promise<void>;
      }
    ).fail = async (args) => {
      capturedArgs = args;
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await service.fail(unpaidLightningQuote, 'network error');

    expect(capturedArgs).toEqual({ id: 'quote-1', reason: 'network error' });
  });
});

// ---------------------------------------------------------------------------
// Tests: markMeltInitiated
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteService.markMeltInitiated', () => {
  it('is a no-op when meltInitiated is already true', async () => {
    const repo = makeFakeRepo();
    let markCalled = false;
    (
      repo as unknown as {
        markMeltInitiated: (
          q: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
        ) => Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }>;
      }
    ).markMeltInitiated = async () => {
      markCalled = true;
      return unpaidCashuTokenQuoteMeltInitiated as CashuReceiveQuote & {
        type: 'CASHU_TOKEN';
      };
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    const result = await service.markMeltInitiated(
      unpaidCashuTokenQuoteMeltInitiated as CashuReceiveQuote & {
        type: 'CASHU_TOKEN';
      },
    );

    expect(result).toBe(unpaidCashuTokenQuoteMeltInitiated);
    expect(markCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when state is not UNPAID', async () => {
    const paidCashuToken: CashuReceiveQuote & { type: 'CASHU_TOKEN' } = {
      ...baseQuote,
      type: 'CASHU_TOKEN',
      state: 'PAID',
      keysetId: '009a1f293253e41e',
      keysetCounter: 0,
      outputAmounts: [64, 32, 4],
      tokenReceiveData: unpaidCashuTokenQuote.tokenReceiveData,
    };
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await expect(
      service.markMeltInitiated(paidCashuToken),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls repo.markMeltInitiated and returns updated quote', async () => {
    let capturedQuote:
      | (CashuReceiveQuote & { type: 'CASHU_TOKEN' })
      | undefined;
    const expectedResult =
      unpaidCashuTokenQuoteMeltInitiated as CashuReceiveQuote & {
        type: 'CASHU_TOKEN';
      };
    const repo = makeFakeRepo();
    (
      repo as unknown as {
        markMeltInitiated: (
          q: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
        ) => Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }>;
      }
    ).markMeltInitiated = async (q) => {
      capturedQuote = q;
      return expectedResult;
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    const result = await service.markMeltInitiated(
      unpaidCashuTokenQuote as CashuReceiveQuote & { type: 'CASHU_TOKEN' },
    );

    expect(result).toBe(expectedResult);
    expect(capturedQuote).toBe(unpaidCashuTokenQuote);
  });
});

// ---------------------------------------------------------------------------
// Tests: createReceiveQuote
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteService.createReceiveQuote', () => {
  it('throws DomainError(invalid_state) when mintQuote is not UNPAID', async () => {
    const fakeMintQuote = {
      quote: 'mint-quote-id',
      request: 'lnbc...',
      state: MintQuoteState.PAID,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      amount: 100,
      unit: 'sat',
    };
    const lightningQuote = {
      mintQuote: fakeMintQuote,
      lockingPublicKey: 'pubkey',
      fullLockingDerivationPath: "m/129372'/0'/0'/42",
      expiresAt: new Date(fakeMintQuote.expiry * 1000).toISOString(),
      amount: btcMoney(100),
      paymentHash: 'ph-abc',
    };
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const account = makeFakeAccount(fakeWallet);

    await expect(
      service.createReceiveQuote({
        userId: 'user-1',
        account,
        lightningQuote: lightningQuote as never,
        receiveType: 'LIGHTNING',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('calls repo.create with receiveType LIGHTNING for a LIGHTNING quote', async () => {
    const fakeMintQuote = {
      quote: 'mint-quote-id',
      request: 'lnbc...',
      state: MintQuoteState.UNPAID,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      amount: 100,
      unit: 'sat',
    };
    const lightningQuote = {
      mintQuote: fakeMintQuote,
      lockingPublicKey: 'pubkey',
      fullLockingDerivationPath: "m/129372'/0'/0'/42",
      expiresAt: new Date(fakeMintQuote.expiry * 1000).toISOString(),
      amount: btcMoney(100),
      paymentHash: 'ph-abc',
    };

    let capturedArgs:
      | Parameters<CashuReceiveQuoteRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo();
    repo.create = async (args) => {
      capturedArgs = args;
      return unpaidLightningQuote;
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const account = makeFakeAccount(fakeWallet);

    const result = await service.createReceiveQuote({
      userId: 'user-1',
      account,
      lightningQuote: lightningQuote as never,
      receiveType: 'LIGHTNING',
    });

    expect(result).toBe(unpaidLightningQuote);
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.receiveType).toBe('LIGHTNING');
    expect(capturedArgs!.userId).toBe('user-1');
    expect(capturedArgs!.accountId).toBe('acc-1');
    expect(capturedArgs!.quoteId).toBe('mint-quote-id');
  });
});

// ---------------------------------------------------------------------------
// Tests: completeReceive
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteService.completeReceive', () => {
  it('throws DomainError(invalid_state) when quote does not belong to account', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const otherAccount = { ...makeFakeAccount(fakeWallet), id: 'acc-other' };

    await expect(
      service.completeReceive(
        otherAccount as CashuAccount,
        unpaidLightningQuote,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('throws DomainError(invalid_state) when quote is EXPIRED', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const account = makeFakeAccount(fakeWallet);

    await expect(
      service.completeReceive(account, expiredLightningQuote),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('throws DomainError(invalid_state) when quote is FAILED', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const account = makeFakeAccount(fakeWallet);

    await expect(
      service.completeReceive(account, failedLightningQuote),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('is a no-op when quote is already COMPLETED', async () => {
    const repo = makeFakeRepo();
    let completeCalled = false;
    repo.completeReceive = async () => {
      completeCalled = true;
      return {
        quote: completedLightningQuote,
        account: makeFakeAccount(makeFakeWallet()),
        addedProofs: [],
      };
    };
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const fakeWallet = makeFakeWallet();
    const account = makeFakeAccount(fakeWallet);

    const result = await service.completeReceive(
      account,
      completedLightningQuote,
    );

    expect(result.quote).toBe(completedLightningQuote);
    expect(result.addedProofs).toEqual([]);
    expect(completeCalled).toBe(false);
  });

  it('happy path PAID: calls repo.completeReceive with minted proofs and returns addedProofs', async () => {
    const mintedProofs = [makeProof(64), makeProof(32), makeProof(4)];
    const fakeWallet = makeFakeWallet({ mintBolt11Result: mintedProofs });
    const account = makeFakeAccount(fakeWallet);
    const resultAccount = makeFakeAccount(fakeWallet);

    let capturedCompleteArgs:
      | Parameters<CashuReceiveQuoteRepository['completeReceive']>[0]
      | undefined;

    const repo = makeFakeRepo({
      completeReceiveResult: {
        quote: completedLightningQuote,
        account: resultAccount,
        addedProofs: ['proof-id-1', 'proof-id-2', 'proof-id-3'],
      },
    });
    repo.completeReceive = async (args) => {
      capturedCompleteArgs = args;
      return {
        quote: completedLightningQuote,
        account: resultAccount,
        addedProofs: ['proof-id-1', 'proof-id-2', 'proof-id-3'],
      };
    };

    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const result = await service.completeReceive(account, paidLightningQuote);

    expect(result.quote).toBe(completedLightningQuote);
    expect(result.account).toBe(resultAccount);
    expect(result.addedProofs).toEqual([
      'proof-id-1',
      'proof-id-2',
      'proof-id-3',
    ]);
    expect(capturedCompleteArgs!.quoteId).toBe('quote-1');
    expect(capturedCompleteArgs!.proofs).toHaveLength(3);
  });

  it('UNPAID path: calls processPayment then processPaidQuote and returns addedProofs', async () => {
    const mintedProofs = [makeProof(64), makeProof(32), makeProof(4)];
    const fakeWallet = makeFakeWallet({ mintBolt11Result: mintedProofs });
    const account = makeFakeAccount(fakeWallet);
    const resultAccount = makeFakeAccount(fakeWallet);

    let processPaymentCalled = false;
    let completeReceiveCalled = false;

    const repo = makeFakeRepo();
    repo.processPayment = async () => {
      processPaymentCalled = true;
      return { quote: paidLightningQuote, account: resultAccount };
    };
    repo.completeReceive = async () => {
      completeReceiveCalled = true;
      return {
        quote: completedLightningQuote,
        account: resultAccount,
        addedProofs: ['proof-id-1'],
      };
    };

    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const result = await service.completeReceive(account, unpaidLightningQuote);

    expect(processPaymentCalled).toBe(true);
    expect(completeReceiveCalled).toBe(true);
    expect(result.addedProofs).toEqual(['proof-id-1']);
  });

  it('mintProofs recovery: restores proofs when OUTPUT_ALREADY_SIGNED', async () => {
    const { MintOperationError } = await import('@cashu/cashu-ts');
    const mintError = new MintOperationError(11003, 'output already signed');
    const restoredProofs = [makeProof(64), makeProof(32), makeProof(4)];

    const fakeWallet = makeFakeWallet({
      mintBolt11Result: async () => {
        throw mintError;
      },
      restoreResult: restoredProofs,
    });
    const account = makeFakeAccount(fakeWallet);
    const resultAccount = makeFakeAccount(fakeWallet);

    let capturedProofs: Proof[] | undefined;
    const repo = makeFakeRepo();
    repo.completeReceive = async (args) => {
      capturedProofs = args.proofs;
      return {
        quote: completedLightningQuote,
        account: resultAccount,
        addedProofs: ['proof-id-1'],
      };
    };

    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    const result = await service.completeReceive(account, paidLightningQuote);

    expect(result.quote.state).toBe('COMPLETED');
    expect(capturedProofs).toEqual(restoredProofs);
  });

  it('mintProofs recovery: restores proofs when QUOTE_ALREADY_ISSUED', async () => {
    const { MintOperationError } = await import('@cashu/cashu-ts');
    const mintError = new MintOperationError(20002, 'quote already issued');
    const restoredProofs = [makeProof(64), makeProof(32), makeProof(4)];

    const fakeWallet = makeFakeWallet({
      mintBolt11Result: async () => {
        throw mintError;
      },
      restoreResult: restoredProofs,
    });
    const account = makeFakeAccount(fakeWallet);
    const resultAccount = makeFakeAccount(fakeWallet);

    let capturedProofs: Proof[] | undefined;
    const repo = makeFakeRepo();
    repo.completeReceive = async (args) => {
      capturedProofs = args.proofs;
      return {
        quote: completedLightningQuote,
        account: resultAccount,
        addedProofs: ['proof-id-1'],
      };
    };

    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);
    await service.completeReceive(account, paidLightningQuote);

    expect(capturedProofs).toEqual(restoredProofs);
  });

  it('mintProofs: rethrows unknown errors', async () => {
    const fakeWallet = makeFakeWallet({
      mintBolt11Result: async () => {
        throw new Error('network timeout');
      },
    });
    const account = makeFakeAccount(fakeWallet);
    const repo = makeFakeRepo();
    const service = new CashuReceiveQuoteService(makeFakeCryptography(), repo);

    await expect(
      service.completeReceive(account, paidLightningQuote),
    ).rejects.toThrow('network timeout');
  });
});
