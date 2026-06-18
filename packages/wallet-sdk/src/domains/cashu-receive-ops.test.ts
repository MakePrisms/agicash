import { describe, expect, it, mock } from 'bun:test';
import * as actualCashu from '@agicash/cashu';
import { NetworkError } from '@cashu/cashu-ts';
import { DomainError } from '../errors';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { CashuReceiveOps } from './cashu-receive-ops';

// getClaimableToken (Task 1) calls these two @agicash/cashu helpers; swap their
// impls per test. Spread the real module so areMintUrlsEqual etc. stay real for
// the receiveToken tests below.
const cashuStub: {
  getUnspentProofsFromToken: (t: unknown) => Promise<unknown[]>;
  getClaimableProofs: (
    proofs: unknown[],
    keys: string[],
  ) =>
    | { claimableProofs: unknown[]; cannotClaimReason: null }
    | { claimableProofs: null; cannotClaimReason: string };
} = {
  getUnspentProofsFromToken: mock(
    async (_t: unknown): Promise<unknown[]> => [],
  ),
  getClaimableProofs: mock((proofs: unknown[], _keys: string[]) => ({
    claimableProofs: proofs,
    cannotClaimReason: null,
  })),
};
mock.module('@agicash/cashu', () => ({
  ...actualCashu,
  getUnspentProofsFromToken: (...a: unknown[]) =>
    (cashuStub.getUnspentProofsFromToken as (...x: unknown[]) => unknown)(...a),
  getClaimableProofs: (...a: unknown[]) =>
    (cashuStub.getClaimableProofs as (...x: unknown[]) => unknown)(...a),
}));

// --- fakes -----------------------------------------------------------------
const USER = { id: 'user-1', defaultCurrency: 'BTC' } as any;

const cashuAcct = (over: Record<string, unknown> = {}) =>
  ({
    id: 'acc-cashu',
    type: 'cashu',
    purpose: 'transactional',
    currency: 'BTC',
    mintUrl: 'https://mint.a/',
    isDefault: true,
    isUnknown: false,
    isSource: true,
    isOnline: true,
    isTestMint: false,
    canReceive: true,
    wallet: {
      meltProofsIdempotent: mock(async () => undefined),
      getMintInfo: () => ({ isSupported: () => ({ disabled: false }) }),
    },
    ...over,
  }) as any;

const sparkAcct = (over: Record<string, unknown> = {}) =>
  ({
    id: 'acc-spark',
    type: 'spark',
    purpose: 'send',
    currency: 'BTC',
    canReceive: true,
    ...over,
  }) as any;

const makeOps = (over: Partial<Record<string, any>> = {}) => {
  const events = new EventBus<SdkCoreEventMap>();
  const source = cashuAcct();
  const deps: any = {
    service: { completeReceive: mock(async () => ({ account: cashuAcct() })) },
    repository: { get: mock(async () => null) },
    events,
    getCurrentUserId: mock(async () => USER.id),
    swapService: {
      create: mock(async () => ({
        swap: { transactionId: 'tx-swap', state: 'PENDING', tokenHash: 'h' },
        account: cashuAcct(),
      })),
      completeSwap: mock(async () => ({
        swap: { state: 'COMPLETED' },
        account: cashuAcct(),
      })),
    },
    sparkReceiveQuoteService: { complete: mock(async () => undefined) },
    accountRepository: { getAllActive: mock(async () => [source]) },
    accountService: {
      addCashuAccount: mock(async () => cashuAcct({ id: 'acc-added' })),
    },
    receiveTokenService: {
      getSourceAndDestinationAccounts: mock(async () => ({
        sourceAccount: source,
        possibleDestinationAccounts: [source],
      })),
    },
    receiveTokenQuoteService: {
      createCrossAccountReceiveQuotes: mock(async () => ({
        destinationType: 'cashu',
        destinationAccount: cashuAcct({
          id: 'acc-dest',
          mintUrl: 'https://mint.b/',
        }),
        cashuReceiveQuote: { id: 'q', transactionId: 'tx-cross' },
        cashuMeltQuote: { quote: 'mq', amount: 1 },
        lightningReceiveQuote: { transactionId: 'tx-cross' },
      })),
    },
    getUser: mock(async () => USER),
    setDefaultAccount: mock(async () => USER),
    getExchangeRate: mock(async () => '1'),
    ...over,
  };
  return { ops: new CashuReceiveOps(deps), deps, source };
};

// --- tests -----------------------------------------------------------------
describe('CashuReceiveOps.receiveToken', () => {
  it('same-account: creates swap, completes inline, returns the swap transactionId', async () => {
    const { ops, deps } = makeOps();
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-swap');
    expect(result.destinationAccount).toEqual({
      id: 'acc-cashu',
      purpose: 'transactional',
    });
    expect(deps.swapService.create).toHaveBeenCalledTimes(1);
    expect(deps.swapService.completeSwap).toHaveBeenCalledTimes(1);
  });

  it('same-account: throws DomainError when completeSwap returns terminal FAILED', async () => {
    const { ops } = makeOps({
      swapService: {
        create: mock(async () => ({
          swap: { transactionId: 'tx', state: 'PENDING' },
          account: cashuAcct(),
        })),
        completeSwap: mock(async () => ({
          swap: { state: 'FAILED', failureReason: 'boom' },
          account: cashuAcct(),
        })),
      },
    });
    await expect(
      ops.receiveToken({
        token: { mint: 'https://mint.a/', proofs: [] } as any,
        claimTo: 'cashu',
      }),
    ).rejects.toThrow('boom');
  });

  it('same-account: tolerates a THROWN completeSwap error (background finalizes) and still resolves', async () => {
    const { ops } = makeOps({
      swapService: {
        create: mock(async () => ({
          swap: { transactionId: 'tx-ok', state: 'PENDING' },
          account: cashuAcct(),
        })),
        completeSwap: mock(async () => {
          throw new Error('network');
        }),
      },
    });
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-ok');
  });

  it('throws DomainError when no receive account is available', async () => {
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: cashuAcct({ canReceive: false }),
          possibleDestinationAccounts: [],
        })),
      },
    });
    await expect(
      ops.receiveToken({
        token: { mint: 'https://x/', proofs: [] } as any,
        claimTo: 'cashu',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('cross-account cashu: melts then completes the receive, returns the quote transactionId', async () => {
    const source = cashuAcct({
      mintUrl: 'https://mint.a/',
      purpose: 'transactional',
      isDefault: false,
    });
    const dest = cashuAcct({
      id: 'acc-dest',
      mintUrl: 'https://mint.b/',
      isSource: false,
      isDefault: true,
    });
    const { ops, deps } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source, dest],
        })),
      },
      accountRepository: { getAllActive: mock(async () => [source, dest]) },
    });
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-cross');
    expect(source.wallet.meltProofsIdempotent).toHaveBeenCalledTimes(1);
    // best-effort complete on the quote service (deps.service.completeReceive)
    expect(deps.service.completeReceive).toHaveBeenCalledTimes(1);
  });

  it('cross-account: propagates a melt failure (the non-swallowed step)', async () => {
    const source = cashuAcct({
      mintUrl: 'https://mint.a/',
      purpose: 'transactional',
      isDefault: false,
      wallet: {
        meltProofsIdempotent: mock(async () => {
          throw new Error('melt-failed');
        }),
        getMintInfo: () => ({ isSupported: () => ({ disabled: false }) }),
      },
    });
    const dest = cashuAcct({
      id: 'acc-dest',
      mintUrl: 'https://mint.b/',
      isDefault: true,
    });
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source, dest],
        })),
      },
    });
    await expect(
      ops.receiveToken({
        token: { mint: 'https://mint.a/', proofs: [] } as any,
        claimTo: 'cashu',
      }),
    ).rejects.toThrow('melt-failed');
  });

  it('cross-account spark: resolves the Breez race via paymentSucceeded, then completes the spark quote', async () => {
    const source = cashuAcct({
      mintUrl: 'https://mint.a/',
      purpose: 'transactional',
      isDefault: false,
    });
    let captured: ((e: any) => void) | undefined;
    const sparkDest = sparkAcct({
      id: 'acc-spark-dest',
      wallet: {
        addEventListener: mock(async (l: { onEvent: (e: any) => void }) => {
          captured = l.onEvent;
          return 'lid';
        }),
        removeEventListener: mock(async () => true),
        getPaymentByInvoice: mock(async () => ({ payment: undefined })),
      },
    });
    const completeSpark = mock(async () => undefined);
    const { ops } = makeOps({
      accountRepository: {
        getAllActive: mock(async () => [source, sparkDest]),
      },
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source, sparkDest],
        })),
      },
      sparkReceiveQuoteService: { complete: completeSpark },
      receiveTokenQuoteService: {
        createCrossAccountReceiveQuotes: mock(async () => ({
          destinationType: 'spark',
          destinationAccount: sparkDest,
          sparkReceiveQuote: {
            id: 'sq',
            transactionId: 'tx-spark',
            paymentHash: 'ph',
            paymentRequest: 'lnbc',
            sparkId: 's',
          },
          cashuMeltQuote: { quote: 'mq', amount: 1 },
          lightningReceiveQuote: { transactionId: 'tx-spark' },
        })),
      },
    });
    const promise = ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'spark',
    });
    // let the listener register, then fire the matching event
    await new Promise((r) => setTimeout(r, 10));
    captured?.({
      type: 'paymentSucceeded',
      payment: {
        id: 'spark-tx',
        details: {
          type: 'lightning',
          htlcDetails: { paymentHash: 'ph', preimage: 'pre' },
        },
      },
    });
    const result = await promise;
    expect(result.transactionId).toBe('tx-spark');
    expect(completeSpark).toHaveBeenCalledWith(
      expect.anything(),
      'pre',
      'spark-tx',
    );
  });

  it('set-default failure is non-fatal', async () => {
    const { ops } = makeOps({
      setDefaultAccount: mock(async () => {
        throw new Error('db');
      }),
    });
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-swap');
  });
});

describe('CashuReceiveOps.getClaimableToken', () => {
  const TOKEN = {
    mint: 'https://mint.a/',
    unit: 'sat',
    proofs: [{ id: 'p1' }],
  } as any;

  it('returns the token narrowed to claimable proofs', async () => {
    cashuStub.getUnspentProofsFromToken = mock(
      async () => [{ id: 'p1' }] as any,
    );
    cashuStub.getClaimableProofs = mock(() => ({
      claimableProofs: [{ id: 'p1' }] as any,
      cannotClaimReason: null,
    }));
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBeNull();
    expect(result.claimableToken).toEqual({ ...TOKEN, proofs: [{ id: 'p1' }] });
  });

  it('returns a reason (no throw) when the mint is offline', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => {
      throw new NetworkError('down');
    });
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.claimableToken).toBeNull();
    expect(result.cannotClaimReason).toBe(
      'The mint that issued this ecash is offline',
    );
  });

  it('returns "already been spent" when no proofs are unspent', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => []);
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBe('This ecash has already been spent');
  });

  it('returns the not-claimable reason from getClaimableProofs', async () => {
    cashuStub.getUnspentProofsFromToken = mock(
      async () => [{ id: 'p1' }] as any,
    );
    cashuStub.getClaimableProofs = mock(() => ({
      claimableProofs: null,
      cannotClaimReason: 'You do not have permission to claim this ecash',
    }));
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.claimableToken).toBeNull();
    expect(result.cannotClaimReason).toBe(
      'You do not have permission to claim this ecash',
    );
  });

  it('maps an unknown error to a generic reason', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => {
      throw new Error('boom');
    });
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBe(
      'An error occurred while checking the token',
    );
  });
});

describe('CashuReceiveOps.getTokenAccounts', () => {
  const TOKEN = { mint: 'https://mint.a/', proofs: [] } as any;

  it('returns source, possible destinations, and the default receive account', async () => {
    const source = cashuAcct(); // isDefault:true, canReceive:true, mint.a
    const { ops, deps } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source],
        })),
      },
    });
    const result = await ops.getTokenAccounts({ token: TOKEN });
    expect(result.sourceAccount).toBe(source);
    expect(result.possibleDestinationAccounts).toEqual([source]);
    expect(result.defaultReceiveAccount?.id).toBe('acc-cashu');
    expect(deps.accountRepository.getAllActive).toHaveBeenCalledWith('user-1');
  });

  it('returns a null default when the token cannot be claimed', async () => {
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: cashuAcct({ canReceive: false }),
          possibleDestinationAccounts: [],
        })),
      },
    });
    const result = await ops.getTokenAccounts({
      token: { mint: 'https://x/', proofs: [] } as any,
    });
    expect(result.defaultReceiveAccount).toBeNull();
  });
});
