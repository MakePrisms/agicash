import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { Proof, Token } from '@cashu/cashu-ts';
import { DomainError } from '../../errors';
import type {
  CashuReceiveSwap,
  CashuReceiveSwapRepository,
} from '../../internal/repositories/cashu-receive-swap-repository';
import type { CashuAccount } from '../../types/account';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeProof(amount: number): Proof {
  return {
    id: '009a1f293253e41e',
    amount,
    secret: `secret-${amount}-${Math.random()}`,
    C: 'C-value',
  };
}

function makeToken(proofs: Proof[], mint = 'https://mint.example.com'): Token {
  return { mint, proofs, unit: 'sat' };
}

function btcMoney(amount: number): Money<Currency> {
  return new Money({ amount, currency: 'BTC', unit: 'sat' }) as unknown as Money<Currency>;
}

const pendingSwap: CashuReceiveSwap = {
  tokenHash: 'hash-abc',
  tokenProofs: [makeProof(100)],
  tokenDescription: undefined,
  userId: 'user-1',
  accountId: 'acc-1',
  inputAmount: btcMoney(100),
  amountReceived: btcMoney(99),
  feeAmount: btcMoney(1),
  keysetId: '009a1f293253e41e',
  keysetCounter: 0,
  outputAmounts: [64, 32, 2, 1],
  transactionId: 'txn-1',
  createdAt: '2024-01-01T00:00:00Z',
  version: 1,
  state: 'PENDING',
};

const completedSwap: CashuReceiveSwap = { ...pendingSwap, state: 'COMPLETED' };
const failedSwap: CashuReceiveSwap = {
  ...pendingSwap,
  state: 'FAILED',
  failureReason: 'Token already claimed',
};

// A minimal Keyset shape for the wallet fake — only `keys` is used by splitAmount.
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

function makeFakeWallet(options: {
  mintUrl?: string;
  unit?: string;
  getFeesResult?: number;
  receiveResult?: Proof[] | 'throw' | { type: 'mintError'; code: number; message: string };
  restoreResult?: Proof[];
  keysetId?: string;
} = {}) {
  const {
    mintUrl = 'https://mint.example.com',
    unit = 'sat',
    getFeesResult = 1,
    receiveResult = [makeProof(99)],
    restoreResult = [makeProof(99)],
    keysetId = '009a1f293253e41e',
  } = options;

  return {
    mint: { mintUrl },
    unit,
    keysetId,
    seed: new Uint8Array(64),
    keyChain: {
      ensureKeysetKeys: async (_id: string) => {},
    },
    getKeyset: (_id?: string) => fakeKeyset,
    getFeesForProofs: (_proofs: Proof[]) => getFeesResult,
    ops: {
      receive: (_token: Token) => ({
        asCustom: (_data: unknown) => ({
          run: async (): Promise<Proof[]> => {
            if (receiveResult === 'throw') {
              throw new Error('receive failed');
            }
            if (typeof receiveResult === 'object' && 'type' in receiveResult && receiveResult.type === 'mintError') {
              const err = Object.assign(new Error(receiveResult.message), {
                code: receiveResult.code,
                constructor: { name: 'MintOperationError' },
              });
              // Use the real MintOperationError from cashu-ts
              const { MintOperationError } = await import('@cashu/cashu-ts');
              const mintErr = new MintOperationError(receiveResult.code, receiveResult.message);
              throw mintErr;
            }
            return receiveResult as Proof[];
          },
        }),
      }),
    },
    restore: async (_start: number, _count: number, _config?: { keysetId?: string }) => ({
      proofs: restoreResult,
    }),
  };
}

function makeFakeAccount(wallet: ReturnType<typeof makeFakeWallet>): CashuAccount {
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

function makeFakeRepo(options: {
  createResult?: { swap: CashuReceiveSwap; account: CashuAccount };
  failResult?: CashuReceiveSwap;
  completeResult?: { swap: CashuReceiveSwap; account: CashuAccount; addedProofs: string[] };
} = {}): CashuReceiveSwapRepository {
  return {
    create: async () =>
      options.createResult ?? { swap: pendingSwap, account: {} as CashuAccount },
    fail: async () => options.failResult ?? failedSwap,
    completeReceiveSwap: async () =>
      options.completeResult ?? { swap: completedSwap, account: {} as CashuAccount, addedProofs: ['proof-id-1'] },
    getByTransactionId: async () => null,
    getPending: async () => [],
    toReceiveSwap: async () => pendingSwap,
  } as unknown as CashuReceiveSwapRepository;
}

// ---------------------------------------------------------------------------
// Tests: create
// ---------------------------------------------------------------------------

describe('CashuReceiveSwapService.create', () => {
  it('throws DomainError(mint_mismatch) when token mint differs from account mint', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const token = makeToken([makeProof(100)], 'https://other-mint.example.com');
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(
      service.create({ userId: 'user-1', token, account }),
    ).rejects.toThrow(DomainError);

    await expect(
      service.create({ userId: 'user-1', token, account }),
    ).rejects.toMatchObject({ code: 'mint_mismatch' });
  });

  it('throws DomainError(currency_mismatch) when token currency differs from account currency', async () => {
    // USD token (unit='usd') into BTC account
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const token: Token = { mint: 'https://mint.example.com', proofs: [makeProof(100)], unit: 'usd' };
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(
      service.create({ userId: 'user-1', token, account }),
    ).rejects.toMatchObject({ code: 'currency_mismatch' });
  });

  it('throws DomainError(token_too_small) when fee exceeds token value', async () => {
    // Fee is 100, token is only worth 50 → amountToReceive <= 0
    const wallet = makeFakeWallet({ getFeesResult: 100 });
    const account = makeFakeAccount(wallet);
    const token = makeToken([makeProof(50)]);
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(
      service.create({ userId: 'user-1', token, account }),
    ).rejects.toMatchObject({ code: 'token_too_small' });
  });

  it('happy path: calls repo.create with computed amounts and returns {swap, account}', async () => {
    const wallet = makeFakeWallet({ getFeesResult: 1 });
    const account = makeFakeAccount(wallet);
    const token = makeToken([makeProof(100)]);

    let capturedArgs: Parameters<CashuReceiveSwapRepository['create']>[0] | undefined;
    const resultAccount = makeFakeAccount(wallet);
    const repo = makeFakeRepo({
      createResult: { swap: pendingSwap, account: resultAccount },
    });
    // Intercept the create call to capture args
    const originalCreate = repo.create.bind(repo);
    repo.create = async (args) => {
      capturedArgs = args;
      return originalCreate(args);
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.create({ userId: 'user-1', token, account });

    expect(result.swap).toBe(pendingSwap);
    expect(result.account).toBe(resultAccount);

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.userId).toBe('user-1');
    expect(capturedArgs!.accountId).toBe('acc-1');
    expect(capturedArgs!.inputAmount.toNumber('sat')).toBe(100);
    // fee = 1, so receiveAmount = 99
    expect(capturedArgs!.receiveAmount.toNumber('sat')).toBe(99);
    expect(capturedArgs!.cashuReceiveFee.toNumber('sat')).toBe(1);
    // outputAmounts must be an array of numbers summing to 99
    expect(capturedArgs!.outputAmounts.reduce((a, b) => a + b, 0)).toBe(99);
  });

  it('passes reversedTransactionId when provided', async () => {
    const wallet = makeFakeWallet({ getFeesResult: 0 });
    const account = makeFakeAccount(wallet);
    const token = makeToken([makeProof(100)]);

    let capturedArgs: Parameters<CashuReceiveSwapRepository['create']>[0] | undefined;
    const repo = makeFakeRepo();
    repo.create = async (args) => {
      capturedArgs = args;
      return { swap: pendingSwap, account };
    };

    const service = new CashuReceiveSwapService(repo);
    await service.create({ userId: 'user-1', token, account, reversedTransactionId: 'txn-orig' });

    expect(capturedArgs!.reversedTransactionId).toBe('txn-orig');
  });
});

// ---------------------------------------------------------------------------
// Tests: fail
// ---------------------------------------------------------------------------

describe('CashuReceiveSwapService.fail', () => {
  it('is a no-op when swap is already FAILED', async () => {
    const repo = makeFakeRepo();
    let failCalled = false;
    repo.fail = async () => {
      failCalled = true;
      return failedSwap;
    };
    const service = new CashuReceiveSwapService(repo);

    const result = await service.fail(failedSwap, 'whatever');

    expect(result).toBe(failedSwap);
    expect(failCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when swap is COMPLETED', async () => {
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(service.fail(completedSwap, 'reason')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('calls repo.fail and returns the updated swap when PENDING', async () => {
    const expectedFailed: CashuReceiveSwap = {
      ...pendingSwap,
      state: 'FAILED',
      failureReason: 'my reason',
    };
    const repo = makeFakeRepo({ failResult: expectedFailed });

    let capturedArgs: { tokenHash: string; userId: string; reason: string } | undefined;
    repo.fail = async (args) => {
      capturedArgs = args;
      return expectedFailed;
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.fail(pendingSwap, 'my reason');

    expect(result).toBe(expectedFailed);
    expect(capturedArgs).toEqual({
      tokenHash: pendingSwap.tokenHash,
      userId: pendingSwap.userId,
      reason: 'my reason',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: completeSwap
// ---------------------------------------------------------------------------

describe('CashuReceiveSwapService.completeSwap', () => {
  it('is a no-op when swap is already COMPLETED', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    let completeCalled = false;
    repo.completeReceiveSwap = async () => {
      completeCalled = true;
      return { swap: completedSwap, account, addedProofs: [] };
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.completeSwap(account, completedSwap);

    expect(result.swap).toBe(completedSwap);
    expect(result.addedProofs).toEqual([]);
    expect(completeCalled).toBe(false);
  });

  it('throws DomainError(invalid_state) when swap is FAILED', async () => {
    const wallet = makeFakeWallet();
    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(service.completeSwap(account, failedSwap)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('happy path: calls repo.completeReceiveSwap and returns addedProofs', async () => {
    const wallet = makeFakeWallet({ receiveResult: [makeProof(64), makeProof(32), makeProof(2), makeProof(1)] });
    const account = makeFakeAccount(wallet);

    let capturedCompleteArgs: { tokenHash: string; userId: string; proofs: Proof[] } | undefined;
    const resultAccount = makeFakeAccount(wallet);
    const resultSwap = { ...completedSwap };

    const repo = makeFakeRepo();
    repo.completeReceiveSwap = async (args) => {
      capturedCompleteArgs = args;
      return { swap: resultSwap, account: resultAccount, addedProofs: ['proof-id-1', 'proof-id-2'] };
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.completeSwap(account, pendingSwap);

    expect(result.swap).toBe(resultSwap);
    expect(result.account).toBe(resultAccount);
    expect(result.addedProofs).toEqual(['proof-id-1', 'proof-id-2']);

    expect(capturedCompleteArgs!.tokenHash).toBe(pendingSwap.tokenHash);
    expect(capturedCompleteArgs!.userId).toBe(pendingSwap.userId);
    expect(capturedCompleteArgs!.proofs).toHaveLength(4);
  });

  it('fails swap and returns empty addedProofs when token is already claimed (TOKEN_ALREADY_SPENT + 0 restored proofs)', async () => {
    const { MintOperationError } = await import('@cashu/cashu-ts');
    // TOKEN_ALREADY_SPENT = 11001
    const mintError = new MintOperationError(11001, 'token already spent');

    const wallet = makeFakeWallet({
      restoreResult: [], // restore returns 0 proofs → token was claimed by someone else
    });
    // override ops.receive to throw the MintOperationError
    wallet.ops.receive = (_token: Token) => ({
      asCustom: (_data: unknown) => ({
        run: async (): Promise<Proof[]> => {
          throw mintError;
        },
      }),
    });

    const account = makeFakeAccount(wallet);
    const expectedFailed: CashuReceiveSwap = {
      ...pendingSwap,
      state: 'FAILED',
      failureReason: 'Token already claimed',
    };

    const repo = makeFakeRepo();
    repo.fail = async () => expectedFailed;

    const service = new CashuReceiveSwapService(repo);
    const result = await service.completeSwap(account, pendingSwap);

    expect(result.swap.state).toBe('FAILED');
    expect(result.addedProofs).toEqual([]);
  });

  it('recovers proofs via restore when OUTPUT_ALREADY_SIGNED (idempotent retry)', async () => {
    const { MintOperationError } = await import('@cashu/cashu-ts');
    // OUTPUT_ALREADY_SIGNED = 11003
    const mintError = new MintOperationError(11003, 'output already signed');
    const restoredProofs = [makeProof(64), makeProof(32), makeProof(2), makeProof(1)];

    const wallet = makeFakeWallet({ restoreResult: restoredProofs });
    wallet.ops.receive = (_token: Token) => ({
      asCustom: (_data: unknown) => ({
        run: async (): Promise<Proof[]> => {
          throw mintError;
        },
      }),
    });

    const account = makeFakeAccount(wallet);
    let capturedProofs: Proof[] | undefined;
    const repo = makeFakeRepo();
    repo.completeReceiveSwap = async (args) => {
      capturedProofs = args.proofs;
      return { swap: completedSwap, account, addedProofs: ['proof-id-1'] };
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.completeSwap(account, pendingSwap);

    expect(result.swap.state).toBe('COMPLETED');
    expect(capturedProofs).toEqual(restoredProofs);
  });

  it('recovers proofs via restore when TOKEN_ALREADY_SPENT but restore returns proofs (interrupted swap)', async () => {
    const { MintOperationError } = await import('@cashu/cashu-ts');
    // TOKEN_ALREADY_SPENT = 11001
    const mintError = new MintOperationError(11001, 'token already spent');
    const restoredProofs = [makeProof(64), makeProof(32), makeProof(2), makeProof(1)];

    const wallet = makeFakeWallet({ restoreResult: restoredProofs });
    wallet.ops.receive = (_token: Token) => ({
      asCustom: (_data: unknown) => ({
        run: async (): Promise<Proof[]> => {
          throw mintError;
        },
      }),
    });

    const account = makeFakeAccount(wallet);
    let capturedProofs: Proof[] | undefined;
    const repo = makeFakeRepo();
    repo.completeReceiveSwap = async (args) => {
      capturedProofs = args.proofs;
      return { swap: completedSwap, account, addedProofs: ['proof-id-1'] };
    };

    const service = new CashuReceiveSwapService(repo);
    const result = await service.completeSwap(account, pendingSwap);

    expect(result.swap.state).toBe('COMPLETED');
    expect(result.addedProofs).toEqual(['proof-id-1']);
    expect(capturedProofs).toEqual(restoredProofs);
  });

  it('rethrows unknown errors from swapProofs', async () => {
    const wallet = makeFakeWallet();
    wallet.ops.receive = (_token: Token) => ({
      asCustom: (_data: unknown) => ({
        run: async (): Promise<Proof[]> => {
          throw new Error('network timeout');
        },
      }),
    });

    const account = makeFakeAccount(wallet);
    const repo = makeFakeRepo();
    const service = new CashuReceiveSwapService(repo);

    await expect(service.completeSwap(account, pendingSwap)).rejects.toThrow('network timeout');
  });
});
