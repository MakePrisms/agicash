import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import type { CashuAccount, CashuProof } from '../../types/account';
import type { CashuSendSwap } from '../../types/cashu';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { CashuSendSwapService } from './cashu-send-swap-service';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function btcMoney(amount: number): Money<Currency> {
  return new Money({
    amount,
    currency: 'BTC',
    unit: 'sat',
  }) as unknown as Money<Currency>;
}

// A valid compressed SEC-encoded secp256k1 public key hex (66 chars / 33 bytes).
// Used for the proof's unblindedSignature (cashu-ts `Proof.C`) so that
// getTokenHash → encodeToken → cashu-ts can parse it without errors.
const VALID_C_HEX =
  '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904';

function makeCashuProof(
  amount: number,
  secret = `secret-${amount}-${Math.random()}`,
): CashuProof {
  return {
    id: `proof-${amount}-${Math.random()}`,
    accountId: 'acc-1',
    userId: 'user-1',
    keysetId: '009a1f293253e41e',
    amount,
    secret,
    unblindedSignature: VALID_C_HEX,
    publicKeyY: 'Y-value',
    dleq: undefined as unknown as CashuProof['dleq'],
    witness: undefined as unknown as CashuProof['witness'],
    state: 'UNSPENT',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function toProtocolProof(p: CashuProof): Proof {
  return {
    id: p.keysetId,
    amount: p.amount,
    secret: p.secret,
    C: p.unblindedSignature,
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
  /** Fee returned by getFeesForProofs */
  feesForProofs?: number;
  /** Fee returned by getFeesEstimateToReceiveAtLeast */
  feesEstimateToReceive?: number;
  /** Proofs returned by selectProofsToSend */
  selectProofsResult?: { keep: Proof[]; send: Proof[] };
  /** Result of wallet.ops.send(...).run() */
  sendOpsResult?:
    | { keep: Proof[]; send: Proof[] }
    | { type: 'mintError'; code: number; message: string }
    | 'throw';
  /** Proofs returned by wallet.restore */
  restoreResult?: Proof[];
  keysetId?: string;
};

function makeFakeWallet(proofs: CashuProof[], options: FakeWalletOptions = {}) {
  const {
    feesForProofs = 1,
    feesEstimateToReceive = 1,
    selectProofsResult,
    sendOpsResult = { keep: [], send: proofs.map(toProtocolProof) },
    restoreResult = [],
    keysetId = '009a1f293253e41e',
  } = options;

  const defaultSelectResult = {
    keep: [],
    send: proofs.map(toProtocolProof),
  };

  return {
    keysetId,
    seed: new Uint8Array(64),
    keyChain: {
      ensureKeysetKeys: async (_id: string) => {},
      getCheapestKeyset: () => ({ fee: 1000, keys: fakeKeyset.keys }),
    },
    getKeyset: (_id?: string) => fakeKeyset,
    selectProofsToSend: (
      _proofs: Proof[],
      _amount: number,
      _includeFees: boolean,
    ) => selectProofsResult ?? defaultSelectResult,
    getFeesForProofs: (_proofs: Proof[]) => feesForProofs,
    getFeesEstimateToReceiveAtLeast: (_amount: number) => feesEstimateToReceive,
    ops: {
      send: (_amount: number, _inputProofs: Proof[]) => ({
        keyset: (_keysetId: string) => ({
          asCustom: (_data: unknown) => ({
            keepAsCustom: (_keepData: unknown) => ({
              run: async (): Promise<{ keep: Proof[]; send: Proof[] }> => {
                if (sendOpsResult === 'throw') {
                  throw new Error('send failed');
                }
                if (
                  typeof sendOpsResult === 'object' &&
                  'type' in sendOpsResult &&
                  sendOpsResult.type === 'mintError'
                ) {
                  const { MintOperationError } = await import(
                    '@cashu/cashu-ts'
                  );
                  throw new MintOperationError(
                    sendOpsResult.code,
                    sendOpsResult.message,
                  );
                }
                return sendOpsResult as { keep: Proof[]; send: Proof[] };
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
    keysetCounters: { '009a1f293253e41e': 0 },
    proofs,
    wallet: wallet as unknown as CashuAccount['wallet'],
  };
}

// Build minimal CashuSendSwap fixtures

function makeDraftSwap(overrides: Partial<CashuSendSwap> = {}): CashuSendSwap {
  return {
    id: 'swap-1',
    accountId: 'acc-1',
    userId: 'user-1',
    state: 'DRAFT',
    keysetId: '009a1f293253e41e',
    keysetCounter: 0,
    outputAmounts: { send: [100], change: [] },
    inputProofs: [],
    inputAmount: btcMoney(100),
    amountReceived: btcMoney(100),
    cashuReceiveFee: btcMoney(1),
    amountToSend: btcMoney(101),
    cashuSendFee: btcMoney(1),
    amountSpent: btcMoney(102),
    totalFee: btcMoney(2),
    transactionId: 'txn-1',
    createdAt: new Date('2024-01-01'),
    version: 1,
    ...overrides,
  } as CashuSendSwap;
}

function makePendingSwap(
  proofAmount = 100,
  overrides: Partial<CashuSendSwap> = {},
): CashuSendSwap {
  const proofsToSend = [makeCashuProof(proofAmount)];
  return {
    id: 'swap-1',
    accountId: 'acc-1',
    userId: 'user-1',
    state: 'PENDING',
    tokenHash: 'hash-abc',
    proofsToSend,
    inputProofs: [],
    inputAmount: btcMoney(proofAmount),
    amountReceived: btcMoney(proofAmount - 1),
    cashuReceiveFee: btcMoney(1),
    amountToSend: btcMoney(proofAmount),
    cashuSendFee: btcMoney(0),
    amountSpent: btcMoney(proofAmount),
    totalFee: btcMoney(1),
    transactionId: 'txn-1',
    createdAt: new Date('2024-01-01'),
    version: 1,
    ...overrides,
  } as CashuSendSwap;
}

function makeFakeRepo(createResult?: CashuSendSwap): CashuSendSwapRepository {
  const defaultPending = makePendingSwap(100);
  return {
    create: async () => createResult ?? defaultPending,
    commitProofsToSend: async () => {},
    complete: async () => {},
    fail: async () => {},
    getUnresolved: async () => [],
    get: async () => null,
    getByTransactionId: async () => null,
  } as unknown as CashuSendSwapRepository;
}

function makeFakeReceiveSwapService(): CashuReceiveSwapService {
  return {
    create: async () => ({
      swap: {} as never,
      account: {} as CashuAccount,
    }),
    fail: async () => ({}) as never,
    completeSwap: async () => ({
      swap: {} as never,
      account: {} as CashuAccount,
      addedProofs: [],
    }),
  } as unknown as CashuReceiveSwapService;
}

// ---------------------------------------------------------------------------
// Tests: getQuote
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.getQuote', () => {
  it('returns fee fields for exact-proofs path (one selectProofsToSend pass)', async () => {
    // 100 sat proof, fee=1, so proofAmount(100) === requestedAmount(99) + fee(1)=100 → exact path
    const proof = makeCashuProof(100);
    const wallet = makeFakeWallet([proof], {
      feesForProofs: 1,
      selectProofsResult: {
        keep: [],
        send: [toProtocolProof(proof)],
      },
    });
    const account = makeFakeAccount(wallet, [proof]);
    const repo = makeFakeRepo();
    const receiveService = makeFakeReceiveSwapService();
    const service = new CashuSendSwapService(repo, receiveService);

    const quote = await service.getQuote({
      account,
      amount: btcMoney(99),
      senderPaysFee: true,
    });

    // cashuReceiveFee = 1 (feeToSwapSelectedProofs), cashuSendFee = 0 (exact path)
    expect(quote.cashuReceiveFee.toNumber('sat')).toBe(1);
    expect(quote.cashuSendFee.toNumber('sat')).toBe(0);
    expect(quote.amountToSend.toNumber('sat')).toBe(100); // 99 + 1
    expect(quote.totalAmount.toNumber('sat')).toBe(100);
    expect(quote.totalFee.toNumber('sat')).toBe(1);
    expect(quote.senderPaysFee).toBe(true);
  });

  it('throws DomainError(unsupported) when senderPaysFee is false', async () => {
    const proof = makeCashuProof(100);
    const wallet = makeFakeWallet([proof]);
    const account = makeFakeAccount(wallet, [proof]);
    const repo = makeFakeRepo();
    const receiveService = makeFakeReceiveSwapService();
    const service = new CashuSendSwapService(repo, receiveService);

    await expect(
      service.getQuote({ account, amount: btcMoney(99), senderPaysFee: false }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});

// ---------------------------------------------------------------------------
// Tests: create
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.create', () => {
  it('exact-proofs → creates PENDING swap (tokenHash set, no keysetId/outputAmounts)', async () => {
    // Sum of inputProofs (100) === totalAmountToSend (99 + cashuReceiveFee 1 = 100) → exact path
    const proof = makeCashuProof(100, 'secret-exact');
    const wallet = makeFakeWallet([proof], {
      feesForProofs: 1,
      selectProofsResult: { keep: [], send: [toProtocolProof(proof)] },
    });
    const account = makeFakeAccount(wallet, [proof]);

    let capturedCreateArgs:
      | Parameters<CashuSendSwapRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo();
    repo.create = async (args) => {
      capturedCreateArgs = args;
      return makePendingSwap(100);
    };

    const receiveService = makeFakeReceiveSwapService();
    const service = new CashuSendSwapService(repo, receiveService);

    await service.create({
      userId: 'user-1',
      account,
      amount: btcMoney(99),
      senderPaysFee: true,
    });

    expect(capturedCreateArgs).toBeDefined();
    // tokenHash should be set (exact proofs path)
    expect(capturedCreateArgs!.tokenHash).toBeDefined();
    expect(typeof capturedCreateArgs!.tokenHash).toBe('string');
    // No keyset/outputAmounts needed for exact swap
    expect(capturedCreateArgs!.keysetId).toBeUndefined();
    expect(capturedCreateArgs!.outputAmounts).toBeUndefined();
    expect(capturedCreateArgs!.userId).toBe('user-1');
    expect(capturedCreateArgs!.accountId).toBe('acc-1');
  });

  it('inexact proofs → creates DRAFT swap (keysetId + outputAmounts set, no tokenHash)', async () => {
    // 200 sat proof, requesting 99. Fee=1, so totalAmountToSend=100.
    // sumProofs(200) !== 100 → inexact path → DRAFT
    const proof = makeCashuProof(200, 'secret-inexact');
    const wallet = makeFakeWallet([proof], {
      feesForProofs: 1,
      feesEstimateToReceive: 1,
      selectProofsResult: { keep: [], send: [toProtocolProof(proof)] },
    });
    const account = makeFakeAccount(wallet, [proof]);

    let capturedCreateArgs:
      | Parameters<CashuSendSwapRepository['create']>[0]
      | undefined;
    const repo = makeFakeRepo();
    repo.create = async (args) => {
      capturedCreateArgs = args;
      return makeDraftSwap();
    };

    const receiveService = makeFakeReceiveSwapService();
    const service = new CashuSendSwapService(repo, receiveService);

    await service.create({
      userId: 'user-1',
      account,
      amount: btcMoney(99),
      senderPaysFee: true,
    });

    expect(capturedCreateArgs).toBeDefined();
    // No tokenHash for DRAFT swaps
    expect(capturedCreateArgs!.tokenHash).toBeUndefined();
    // keysetId and outputAmounts should be set
    expect(capturedCreateArgs!.keysetId).toBe('009a1f293253e41e');
    expect(capturedCreateArgs!.outputAmounts).toBeDefined();
    expect(Array.isArray(capturedCreateArgs!.outputAmounts!.send)).toBe(true);
    expect(Array.isArray(capturedCreateArgs!.outputAmounts!.change)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: complete
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.complete', () => {
  it('is a no-op when swap is already COMPLETED', async () => {
    const completedSwap: CashuSendSwap = {
      ...makePendingSwap(),
      state: 'COMPLETED',
    } as CashuSendSwap;
    const repo = makeFakeRepo();
    let completeCalled = false;
    repo.complete = async () => {
      completeCalled = true;
    };
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await service.complete(completedSwap);

    expect(completeCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when swap is DRAFT', async () => {
    const draft = makeDraftSwap();
    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(service.complete(draft)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.complete when swap is PENDING', async () => {
    const pending = makePendingSwap();
    const repo = makeFakeRepo();
    let capturedId: string | undefined;
    repo.complete = async (id) => {
      capturedId = id;
    };
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await service.complete(pending);

    expect(capturedId).toBe(pending.id);
  });

  it('throws DomainError(invalid_state) when swap is REVERSED', async () => {
    const reversed: CashuSendSwap = {
      ...makePendingSwap(),
      state: 'REVERSED',
    } as CashuSendSwap;
    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(service.complete(reversed)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: fail
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.fail', () => {
  it('is a no-op when swap is already FAILED', async () => {
    const failedSwap: CashuSendSwap = {
      ...makeDraftSwap(),
      state: 'FAILED',
      failureReason: 'some reason',
    } as CashuSendSwap;
    const repo = makeFakeRepo();
    let failCalled = false;
    repo.fail = async () => {
      failCalled = true;
    };
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await service.fail(failedSwap, 'new reason');

    expect(failCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when swap is PENDING', async () => {
    const pending = makePendingSwap();
    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(service.fail(pending, 'reason')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.fail with swapId + reason when swap is DRAFT', async () => {
    const draft = makeDraftSwap();
    const repo = makeFakeRepo();
    let capturedArgs: { swapId: string; reason: string } | undefined;
    repo.fail = async (args) => {
      capturedArgs = args;
    };
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await service.fail(draft, 'not enough balance');

    expect(capturedArgs).toEqual({
      swapId: draft.id,
      reason: 'not enough balance',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: reverse
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.reverse', () => {
  it('is a no-op when swap is already REVERSED', async () => {
    const reversedSwap: CashuSendSwap = {
      ...makePendingSwap(),
      state: 'REVERSED',
    } as CashuSendSwap;
    const receiveService = makeFakeReceiveSwapService();
    let createCalled = false;
    receiveService.create = async () => {
      createCalled = true;
      return { swap: {} as never, account: {} as CashuAccount };
    };

    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(repo, receiveService);
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet);

    await service.reverse(reversedSwap, account);

    expect(createCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when swap is DRAFT', async () => {
    const draft = makeDraftSwap();
    const repo = makeFakeRepo();
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet);
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(service.reverse(draft, account)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('throws DomainError(account_mismatch) when swap account does not match', async () => {
    const pending = makePendingSwap(100, { accountId: 'acc-other' });
    const repo = makeFakeRepo();
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet); // id = 'acc-1', not 'acc-other'
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(service.reverse(pending, account)).rejects.toMatchObject({
      code: 'account_mismatch',
    });
  });

  it('PENDING → calls cashuReceiveSwapService.create with reversedTransactionId === swap.transactionId', async () => {
    const proofAmount = 100;
    const pending = makePendingSwap(proofAmount);
    const repo = makeFakeRepo();
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet);

    let capturedArgs:
      | Parameters<CashuReceiveSwapService['create']>[0]
      | undefined;
    const receiveService = makeFakeReceiveSwapService();
    receiveService.create = async (args) => {
      capturedArgs = args;
      return { swap: {} as never, account };
    };

    const service = new CashuSendSwapService(repo, receiveService);
    await service.reverse(pending, account);

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.reversedTransactionId).toBe(pending.transactionId);
    expect(capturedArgs!.userId).toBe(pending.userId);
    // Token should use the account's mintUrl
    expect(capturedArgs!.token.mint).toBe(account.mintUrl);
    // Token proofs should come from swap.proofsToSend
    expect(capturedArgs!.token.proofs).toHaveLength(
      (pending as CashuSendSwap & { state: 'PENDING' }).proofsToSend.length,
    );
    // Token unit for BTC should be 'sat'
    expect(capturedArgs!.token.unit).toBe('sat');
  });
});

// ---------------------------------------------------------------------------
// Tests: swapForProofsToSend (happy path)
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.swapForProofsToSend', () => {
  it('happy path: calls commitProofsToSend with tokenHash', async () => {
    const inputProof = makeCashuProof(102, 'secret-input-0');
    const sendProof: Proof = {
      id: '009a1f293253e41e',
      amount: 101,
      secret: 'secret-send-0',
      C: VALID_C_HEX,
    };
    const keepProof: Proof = {
      id: '009a1f293253e41e',
      amount: 1,
      secret: 'secret-keep-0',
      C: VALID_C_HEX,
    };

    const wallet = makeFakeWallet([inputProof], {
      sendOpsResult: { send: [sendProof], keep: [keepProof] },
    });
    const account = makeFakeAccount(wallet, [inputProof]);

    const draft = makeDraftSwap({
      inputProofs: [inputProof],
      amountToSend: btcMoney(101),
      cashuSendFee: btcMoney(0),
      outputAmounts: { send: [64, 32, 4, 1], change: [1] },
    });

    const repo = makeFakeRepo();
    let capturedCommitArgs:
      | Parameters<CashuSendSwapRepository['commitProofsToSend']>[0]
      | undefined;
    repo.commitProofsToSend = async (args) => {
      capturedCommitArgs = args;
    };

    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );
    await service.swapForProofsToSend({ account, swap: draft });

    expect(capturedCommitArgs).toBeDefined();
    expect(typeof capturedCommitArgs!.tokenHash).toBe('string');
    expect(capturedCommitArgs!.proofsToSend).toEqual([sendProof]);
    expect(capturedCommitArgs!.changeProofs).toEqual([keepProof]);
    expect(capturedCommitArgs!.swap).toBe(draft);
  });

  it('throws when swap is not DRAFT', async () => {
    const pending = makePendingSwap();
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(
      service.swapForProofsToSend({ account, swap: pending }),
    ).rejects.toThrow('not DRAFT');
  });

  it('throws when swap does not belong to account', async () => {
    const draft = makeDraftSwap({ accountId: 'acc-other' });
    const wallet = makeFakeWallet([]);
    const account = makeFakeAccount(wallet); // id = 'acc-1'
    const repo = makeFakeRepo();
    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    await expect(
      service.swapForProofsToSend({ account, swap: draft }),
    ).rejects.toThrow('does not belong to account');
  });
});

// ---------------------------------------------------------------------------
// Tests: swapForProofsToSend — recovery path (OUTPUT_ALREADY_SIGNED)
// ---------------------------------------------------------------------------

describe('CashuSendSwapService.swapForProofsToSend (recovery)', () => {
  it('recovers via wallet.restore when OUTPUT_ALREADY_SIGNED', async () => {
    const inputProof = makeCashuProof(102, 'input-secret');
    // The OutputData.secret bytes decode to these secrets — in test we use
    // simple string secrets so the filter can match them.
    const sendSecret = 'send-secret-0';
    const keepSecret = 'keep-secret-0';
    const restoredSend: Proof = {
      id: '009a1f293253e41e',
      amount: 101,
      secret: sendSecret,
      C: VALID_C_HEX,
    };
    const restoredKeep: Proof = {
      id: '009a1f293253e41e',
      amount: 1,
      secret: keepSecret,
      C: VALID_C_HEX,
    };

    const { MintOperationError } = await import('@cashu/cashu-ts');
    // OUTPUT_ALREADY_SIGNED = 11003
    const mintError = new MintOperationError(11003, 'output already signed');

    const wallet = makeFakeWallet([inputProof], {
      sendOpsResult: {
        type: 'mintError',
        code: 11003,
        message: 'output already signed',
      },
      restoreResult: [restoredSend, restoredKeep],
    });

    // Override the ops.send to throw the real MintOperationError and have restore return our proofs.
    // We also need OutputData to have .secret as Uint8Array that decodes to our secrets.
    // Since OutputData.createDeterministicData uses real crypto, we instead override ops.send directly.
    wallet.ops.send = (_amount: number, _proofs: Proof[]) =>
      ({
        keyset: (_keysetId: string) => ({
          asCustom: (sendData: { secret: Uint8Array }[]) => ({
            keepAsCustom: (keepData: { secret: Uint8Array }[]) => ({
              run: async () => {
                throw mintError;
              },
            }),
          }),
        }),
      }) as ReturnType<typeof wallet.ops.send>;

    // Override restore to return proofs that match the OutputData secrets.
    // In real code, OutputData.secret is a Uint8Array; the filter checks textDecoder.decode(s.secret).
    // We cannot match them without real crypto output data, so we verify restore was called
    // and that the result is returned as-is (both send and keep will be empty because
    // our fake secrets won't match the deterministic output data secrets).
    let restoreCalled = false;
    wallet.restore = async (_start, _count, _config) => {
      restoreCalled = true;
      return { proofs: [restoredSend, restoredKeep] };
    };

    const account = makeFakeAccount(wallet, [inputProof]);
    const draft = makeDraftSwap({
      inputProofs: [inputProof],
      amountToSend: btcMoney(101),
      cashuSendFee: btcMoney(0),
      outputAmounts: { send: [64, 32, 4, 1], change: [1] },
    });

    const repo = makeFakeRepo();
    repo.commitProofsToSend = async () => {};

    const service = new CashuSendSwapService(
      repo,
      makeFakeReceiveSwapService(),
    );

    // Should not throw — recovery path triggers
    await service.swapForProofsToSend({ account, swap: draft });

    expect(restoreCalled).toBe(true);
  });
});
