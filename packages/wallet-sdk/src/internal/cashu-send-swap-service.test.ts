import { describe, expect, mock, test } from 'bun:test';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { CashuSendSwapService } from './cashu-send-swap-service';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { type Currency, Money } from '../types/money';
import type { CashuAccount, CashuProof } from '../types/account';
import type { CashuSendSwap } from '../types/cashu';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

function fakeProof(secret: string): CashuProof {
  return {
    id: 'p1',
    accountId: 'acc1',
    userId: 'u1',
    keysetId: 'ks1',
    amount: 50,
    secret,
    unblindedSignature: 'C',
    publicKeyY: 'Y',
    dleq: undefined,
    witness: undefined,
    state: 'RESERVED',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A PENDING token-send swap (reclaimable via reverse). */
function pendingSwap(overrides: Partial<CashuSendSwap> = {}): CashuSendSwap {
  return {
    id: 's1',
    accountId: 'acc1',
    userId: 'u1',
    transactionId: 'tx-orig',
    inputProofs: [fakeProof('in')],
    inputAmount: sats(50),
    amountReceived: sats(48),
    amountToSend: sats(50),
    amountSpent: sats(50),
    cashuReceiveFee: sats(0),
    cashuSendFee: sats(0),
    totalFee: sats(0),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    version: 1,
    state: 'PENDING',
    tokenHash: 'th',
    proofsToSend: [fakeProof('send')],
    ...overrides,
  } as CashuSendSwap;
}

const account = {
  id: 'acc1',
  type: 'cashu',
  mintUrl: 'https://mint.example',
} as CashuAccount;

/** The shape of the arg `CashuReceiveSwapService.create` is called with (the assertion target). */
type ReceiveCreateArg = {
  reversedTransactionId?: string;
  userId: string;
  account: CashuAccount;
  token: { mint: string; unit: string; proofs: unknown[] };
};

function makeService(
  receiveCreate = mock((_arg: ReceiveCreateArg) =>
    Promise.resolve({} as never),
  ),
) {
  const repo = {
    complete: mock(async () => undefined),
    fail: mock(async () => undefined),
  } as unknown as CashuSendSwapRepository;
  const receiveSwapService = {
    create: receiveCreate,
  } as unknown as CashuReceiveSwapService;
  return {
    service: new CashuSendSwapService(repo, receiveSwapService),
    repo,
    receiveCreate,
  };
}

// -- Tests ----------------------------------------------------------------------------------

describe('CashuSendSwapService.reverse (decision 8)', () => {
  test('creates a receive swap tagged with the original transactionId', async () => {
    const { service, receiveCreate } = makeService();
    const swap = pendingSwap();

    await service.reverse(swap, account);

    expect(receiveCreate).toHaveBeenCalledTimes(1);
    const arg = receiveCreate.mock.calls[0][0];
    expect(arg.reversedTransactionId).toBe('tx-orig');
    expect(arg.userId).toBe('u1');
    expect(arg.account).toBe(account);
    expect(arg.token.mint).toBe('https://mint.example');
    expect(arg.token.proofs).toHaveLength(1);
  });

  test('is a no-op when the swap is already REVERSED', async () => {
    const { service, receiveCreate } = makeService();

    await service.reverse(pendingSwap({ state: 'REVERSED' } as never), account);

    expect(receiveCreate).not.toHaveBeenCalled();
  });

  test('rejects a swap that is not PENDING', async () => {
    const { service } = makeService();
    await expect(
      service.reverse(pendingSwap({ state: 'DRAFT' } as never), account),
    ).rejects.toThrow(/not PENDING/);
  });

  test('rejects a swap that does not belong to the account', async () => {
    const { service } = makeService();
    await expect(
      service.reverse(pendingSwap(), {
        id: 'other',
        type: 'cashu',
        mintUrl: 'https://mint.example',
      } as CashuAccount),
    ).rejects.toThrow(/does not belong/);
  });
});

describe('CashuSendSwapService idempotency guards', () => {
  test('complete is a no-op when already COMPLETED', async () => {
    const { service, repo } = makeService();
    await service.complete(pendingSwap({ state: 'COMPLETED' } as never));
    expect(repo.complete).not.toHaveBeenCalled();
  });

  test('complete rejects a non-PENDING swap', async () => {
    const { service } = makeService();
    await expect(
      service.complete(pendingSwap({ state: 'DRAFT' } as never)),
    ).rejects.toThrow(/not PENDING/);
  });

  test('fail is a no-op when already FAILED', async () => {
    const { service, repo } = makeService();
    await service.fail(
      pendingSwap({ state: 'FAILED', failureReason: 'x' } as never),
      'reason',
    );
    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('fail rejects a non-DRAFT swap (only DRAFT swaps are failable)', async () => {
    const { service } = makeService();
    await expect(service.fail(pendingSwap(), 'reason')).rejects.toThrow(
      /not DRAFT/,
    );
  });
});
