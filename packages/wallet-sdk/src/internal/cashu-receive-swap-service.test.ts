import type { Token } from '@cashu/cashu-ts';
import { describe, expect, mock, test } from 'bun:test';
import type {
  CashuReceiveSwap,
  CashuReceiveSwapRepository,
} from './cashu-receive-swap-repository';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';
import type { CashuAccount } from '../types/account';

// -- Fakes ----------------------------------------------------------------------------------

/** A fake live cashu wallet exposing only the methods the create/fee path touches. */
function fakeWallet(overrides: Record<string, unknown> = {}) {
  return {
    keysetId: 'ks1',
    getKeyset: () => ({ id: 'ks1', keys: { '1': '02aa', '2': '02bb' } }),
    getFeesForProofs: () => 0,
    ...overrides,
  };
}

function fakeAccount(wallet: ReturnType<typeof fakeWallet>): CashuAccount {
  return {
    id: 'acc1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: 'https://mint.example',
    wallet,
  } as unknown as CashuAccount;
}

const token: Token = {
  mint: 'https://mint.example',
  unit: 'sat',
  proofs: [
    // amount summed by sumProofs; the value matters, the crypto fields do not for create().
    { id: 'ks1', amount: 100, secret: 's', C: 'C' } as never,
  ],
};

function fakeRepo(
  createImpl?: () => Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>,
): CashuReceiveSwapRepository {
  return {
    create: mock(
      createImpl ??
        (async () => ({
          swap: {} as CashuReceiveSwap,
          account: {} as CashuAccount,
        })),
    ),
    fail: mock(async () => ({ state: 'FAILED' }) as CashuReceiveSwap),
    completeReceiveSwap: mock(async () => ({
      swap: {} as CashuReceiveSwap,
      account: {} as CashuAccount,
      addedProofs: [],
    })),
  } as unknown as CashuReceiveSwapRepository;
}

// -- Tests ----------------------------------------------------------------------------------

describe('CashuReceiveSwapService.create', () => {
  test('creates a same-mint swap (passes the reversedTransactionId through)', async () => {
    const repo = fakeRepo();
    const service = new CashuReceiveSwapService(repo);
    const account = fakeAccount(fakeWallet());

    await service.create({
      userId: 'u1',
      token,
      account,
      reversedTransactionId: 'tx-orig',
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    const createMock = repo.create as unknown as {
      mock: {
        calls: {
          reversedTransactionId?: string;
          accountId: string;
          outputAmounts: number[];
        }[][];
      };
    };
    const arg = createMock.mock.calls[0][0];
    expect(arg.reversedTransactionId).toBe('tx-orig');
    expect(arg.accountId).toBe('acc1');
    // amountToReceive = 100 (proofs) - 0 (fee) → split into power-of-two output amounts.
    expect(arg.outputAmounts.length).toBeGreaterThan(0);
  });

  test('rejects a token from a different mint', async () => {
    const service = new CashuReceiveSwapService(fakeRepo());
    const account = fakeAccount(fakeWallet());

    await expect(
      service.create({
        userId: 'u1',
        token: { ...token, mint: 'https://other.example' },
        account,
      }),
    ).rejects.toThrow(/different mint/);
  });

  test('rejects a token whose net amount (after fee) is not positive', async () => {
    const service = new CashuReceiveSwapService(fakeRepo());
    // fee >= token amount → amountToReceive <= 0.
    const account = fakeAccount(fakeWallet({ getFeesForProofs: () => 100 }));

    await expect(
      service.create({ userId: 'u1', token, account }),
    ).rejects.toThrow(/too small/);
  });
});

describe('CashuReceiveSwapService idempotency / double-claim guards', () => {
  test('fail is a no-op when already FAILED', async () => {
    const repo = fakeRepo();
    const service = new CashuReceiveSwapService(repo);

    const failed = { state: 'FAILED' } as CashuReceiveSwap;
    const result = await service.fail(failed, 'reason');

    expect(result).toBe(failed);
    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('fail rejects a non-PENDING swap', async () => {
    const service = new CashuReceiveSwapService(fakeRepo());
    await expect(
      service.fail({ state: 'COMPLETED' } as CashuReceiveSwap, 'r'),
    ).rejects.toThrow(/not pending/);
  });

  test('completeSwap is a no-op when already COMPLETED', async () => {
    const repo = fakeRepo();
    const service = new CashuReceiveSwapService(repo);
    const account = fakeAccount(fakeWallet());

    const completed = { state: 'COMPLETED' } as CashuReceiveSwap;
    const result = await service.completeSwap(account, completed);

    expect(result.swap).toBe(completed);
    expect(repo.completeReceiveSwap).not.toHaveBeenCalled();
  });

  test('completeSwap rejects a non-PENDING swap', async () => {
    const service = new CashuReceiveSwapService(fakeRepo());
    const account = fakeAccount(fakeWallet());
    await expect(
      service.completeSwap(account, { state: 'FAILED' } as CashuReceiveSwap),
    ).rejects.toThrow(/not pending/);
  });
});
