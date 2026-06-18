import { describe, expect, it, mock } from 'bun:test';
import { DomainError } from '../errors';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { CashuReceiveOps } from './cashu-receive-ops';

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
