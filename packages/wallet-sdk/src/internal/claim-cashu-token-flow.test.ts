import type { Token } from '@cashu/cashu-ts';
import * as cashuTs from '@cashu/cashu-ts';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { ClaimCashuTokenFlow } from './claim-cashu-token-flow';
import * as cashuWalletModule from './cashu-wallet';
import * as libScanModule from './lib-scan';
import { DomainError } from '../errors';

// Mock the decode layer so `claim()` can be driven without a real mint:
//  - `extractCashuToken` (lib-scan) returns the raw token's encoded form + mint metadata;
//  - `getDecodedToken` (cashu-ts) echoes the queued decoded token.
// The same-mint route below resolves the SOURCE account from the user's existing accounts, so it
// never touches `getInitializedCashuWallet` — only the decode needs mocking.
//
// These are installed as `spyOn` SPIES (set up in `beforeEach`, restored in `afterEach`) rather
// than process-global `mock.module` overrides. `lib-scan` re-exports `extractCashuToken` from
// `lib/cashu/token` (the same live binding), and `@cashu/cashu-ts`'s `getDecodedToken` is the
// same binding `lib/cashu/token.test.ts` imports — a sticky `mock.module` here would leak into
// that suite in the same run. Per-test spies that restore in `afterEach` are isolated because
// Bun runs files sequentially and the spies are torn down before the next file's tests run.
let decodedToken: Token = {
  mint: 'https://mint.example',
  unit: 'sat',
  proofs: [{ id: 'ks1', amount: 100, secret: 's', C: 'C' } as never],
};
let getDecodedToken: ReturnType<typeof spyOn>;
let extractCashuToken: ReturnType<typeof spyOn>;
let getInitializedCashuWallet: ReturnType<typeof spyOn>;

beforeEach(() => {
  decodedToken = {
    mint: 'https://mint.example',
    unit: 'sat',
    proofs: [{ id: 'ks1', amount: 100, secret: 's', C: 'C' } as never],
  };
  // Override ONLY `getDecodedToken` / `extractCashuToken` / `getInitializedCashuWallet`; every
  // other export of these modules is left intact.
  getDecodedToken = spyOn(cashuTs, 'getDecodedToken').mockImplementation(
    () => decodedToken,
  );
  extractCashuToken = spyOn(libScanModule, 'extractCashuToken').mockReturnValue(
    {
      encoded: 'cashuAabc',
      metadata: { mint: 'https://mint.example' },
    } as ReturnType<typeof libScanModule.extractCashuToken>,
  );
  // Mock the wallet-init so an UNKNOWN-mint source resolves to an (online) placeholder without a
  // real mint — lets the unknown-mint-destination deferral be exercised.
  getInitializedCashuWallet = spyOn(
    cashuWalletModule,
    'getInitializedCashuWallet',
  ).mockResolvedValue({
    wallet: {} as never,
    isOnline: true,
  } as Awaited<ReturnType<typeof cashuWalletModule.getInitializedCashuWallet>>);
});

import type { CashuAccount } from '../types/account';

// -- Fakes ----------------------------------------------------------------------------------

const cashuAccount = (overrides: Partial<CashuAccount> = {}): CashuAccount =>
  ({
    id: 'acc1',
    name: 'mint.example',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 0,
    expiresAt: null,
    mintUrl: 'https://mint.example',
    isTestMint: false,
    keysetCounters: {},
    proofs: [],
    wallet: {} as never,
    ...overrides,
  }) as CashuAccount;

/** Build the flow + return handles on the two collaborators the same-mint wiring drives. */
function makeFlow(opts: { accounts?: CashuAccount[] } = {}) {
  const accounts = opts.accounts ?? [cashuAccount()];

  const create = mock(async () => ({
    swap: { tokenHash: 'hash-1', transactionId: 'tx-1', state: 'PENDING' },
    account: accounts[0],
  }));
  const stepCashuReceiveSwap = mock(async () => undefined);

  const mintCache = {
    get: mock(async () => ({ allMintKeysets: { keysets: [{ id: 'ks1' }] } })),
  };

  const flow = new ClaimCashuTokenFlow({
    accounts: { getAllActive: mock(async () => accounts) } as never,
    cashuReceiveSwapService: { create } as never,
    receiveCashuTokenQuoteService: {} as never,
    orchestrator: { stepCashuReceiveSwap } as never,
    mintCache: mintCache as never,
  });

  return { flow, create, stepCashuReceiveSwap, mintCache };
}

afterEach(() => {
  // Restore the real module exports so the cashu-ts / lib-scan overrides do not leak into other
  // suites in the same run (e.g. `lib/cashu/token.test.ts`, which exercises the real
  // `getDecodedToken` / `extractCashuToken`).
  getDecodedToken.mockRestore();
  extractCashuToken.mockRestore();
  getInitializedCashuWallet.mockRestore();
});

// -- Tests ----------------------------------------------------------------------------------

describe('ClaimCashuTokenFlow.claimSameMint — creates + kicks off the internal swap', () => {
  test('calls the swap service then steps the orchestrator, returns the destination account', async () => {
    const { flow, create, stepCashuReceiveSwap } = makeFlow();
    const account = cashuAccount({ id: 'acc1', purpose: 'transactional' });

    const result = await flow.claimSameMint('u1', decodedToken, account);

    // The internal CashuReceiveSwap is created...
    expect(create).toHaveBeenCalledTimes(1);
    const createArgs = (create.mock.calls as unknown[][])[0][0];
    expect(createArgs).toMatchObject({ userId: 'u1', account });
    // ...and kicked off through the orchestrator (keyed by the swap's token hash + user).
    expect(stepCashuReceiveSwap).toHaveBeenCalledTimes(1);
    expect(stepCashuReceiveSwap).toHaveBeenCalledWith('hash-1', 'u1');
    // ...and only the destination account projection is returned (the swap stays internal).
    expect(result).toEqual({
      kind: 'same-mint',
      destinationAccount: { id: 'acc1', purpose: 'transactional' },
    });
  });
});

describe('ClaimCashuTokenFlow.claim — routes a same-mint token to the swap path', () => {
  test('default destination (token own mint) → same-mint, creating the internal swap', async () => {
    const { flow, create, stepCashuReceiveSwap } = makeFlow();

    const result = await flow.claim({
      userId: 'u1',
      encodedToken: 'cashuAabc',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(stepCashuReceiveSwap).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'same-mint',
      destinationAccount: { id: 'acc1', purpose: 'transactional' },
    });
  });

  test('an undecodable token throws DomainError (caller swallows to a failure result)', async () => {
    extractCashuToken.mockReturnValueOnce(
      undefined as unknown as ReturnType<
        typeof libScanModule.extractCashuToken
      >,
    );
    const { flow, create } = makeFlow();

    await expect(
      flow.claim({ userId: 'u1', encodedToken: 'not-a-token' }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(create).not.toHaveBeenCalled();
  });

  test('a token from a mint the user has no account for throws DomainError (unknown-mint deferral)', async () => {
    // No account for the token's mint → resolveDefaultDestination throws the deferral.
    decodedToken = {
      mint: 'https://other-mint.example',
      unit: 'sat',
      proofs: [{ id: 'ks1', amount: 100, secret: 's', C: 'C' } as never],
    };
    extractCashuToken.mockReturnValueOnce({
      encoded: 'cashuAabc',
      metadata: { mint: 'https://other-mint.example' },
    } as ReturnType<typeof libScanModule.extractCashuToken>);
    // No accounts → the source resolves to the mocked (online) placeholder wallet, then
    // destination-resolution finds no own-mint account and raises the unknown-mint deferral.
    const { flow } = makeFlow({ accounts: [] });

    await expect(
      flow.claim({ userId: 'u1', encodedToken: 'cashuAabc' }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
