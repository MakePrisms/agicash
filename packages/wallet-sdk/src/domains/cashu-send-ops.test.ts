import { describe, expect, mock, test } from 'bun:test';
import { Money } from '@agicash/money';
import { CashuSendOps } from './cashu-send-ops';

const amount = new Money({
  amount: 100,
  currency: 'BTC',
  unit: 'sat',
}) as Money;
const account = {
  id: 'acc1',
  mintUrl: 'https://mint.example',
} as unknown as Parameters<CashuSendOps['createTokenSend']>[0]['account'];

const pendingSwap = {
  id: 'swap1',
  state: 'PENDING',
  amountToSend: amount,
  proofsToSend: [
    {
      id: 'p1',
      amount: 100,
      secret: 's',
      unblindedSignature: 'C',
      keysetId: 'k',
      publicKeyY: 'Y',
      dleq: undefined,
      witness: undefined,
    },
  ],
};

const makeOps = (over: {
  create?: ReturnType<typeof mock>;
  swap?: ReturnType<typeof mock>;
  swapGet?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new CashuSendOps({
    quoteService: {} as never,
    swapService: {
      create:
        over.create ?? mock(async () => ({ ...pendingSwap, state: 'DRAFT' })),
      swapForProofsToSend: over.swap ?? mock(async () => {}),
    },
    quoteRepository: {} as never,
    swapRepository: {
      get: over.swapGet ?? mock(async () => pendingSwap),
    },
    events: {} as never,
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof CashuSendOps>[0]);

describe('CashuSendOps.createTokenSend', () => {
  test('DRAFT swap → swaps, re-reads, encodes a token', async () => {
    const swap = mock(async () => {});
    const swapGet = mock(async () => pendingSwap);
    const result = await makeOps({
      swap,
      swapGet,
      userId: 'u1',
    }).createTokenSend({ account, amount });
    expect(swap).toHaveBeenCalledTimes(1);
    expect(swapGet).toHaveBeenCalledWith('swap1');
    expect(result.swap.state).toBe('PENDING');
    expect(typeof result.token).toBe('string');
    expect(result.token.startsWith('cashu')).toBe(true);
  });

  test('exact-proofs PENDING swap → no swap call, encodes directly', async () => {
    const create = mock(async () => pendingSwap); // already PENDING
    const swap = mock(async () => {});
    const result = await makeOps({
      create,
      swap,
      userId: 'u1',
    }).createTokenSend({
      account,
      amount,
    });
    expect(swap).not.toHaveBeenCalled();
    expect(result.swap.state).toBe('PENDING');
  });

  test('requires a user', async () => {
    await expect(
      makeOps({ userId: null }).createTokenSend({ account, amount }),
    ).rejects.toThrow('No authenticated user');
  });
});

describe('CashuSendOps.getSwap', () => {
  test('passes through to swapRepository.get', async () => {
    const swapGet = mock(async () => pendingSwap);
    const ops = makeOps({ swapGet, userId: 'u1' });
    const result = await ops.getSwap('s1');
    expect(swapGet).toHaveBeenCalledWith('s1');
    expect(result).toBe(pendingSwap as never);
  });

  test('returns null when swap not found', async () => {
    const swapGet = mock(async () => null);
    const ops = makeOps({ swapGet, userId: 'u1' });
    const result = await ops.getSwap('missing');
    expect(result).toBeNull();
  });
});
