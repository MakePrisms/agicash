/**
 * Orchestrator state-machine tests — Slice 3 / PR5d (the riskiest slice).
 *
 * Pumps each machine via its manually-pumpable `step*` core (NO live WS / Breez loop needed) with
 * fake repos + services, asserting:
 *  - each DB-state → service-call → event transition (the cache→DB substitution: every step reads
 *    fresh repo state, never a cached body);
 *  - idempotency (a step on an already-terminal / missing quote is a safe no-op — no service call,
 *    no event);
 *  - the classify-verdict → error-model handling threaded through `runStep`.
 *
 * The fakes implement only the methods each test path touches.
 */
import { describe, expect, mock, test } from 'bun:test';
import { MeltQuoteState, MintQuoteState } from '@cashu/cashu-ts';
import { Orchestrator, type OrchestratorDeps } from './orchestrator';
import { TypedEventEmitter } from './event-emitter';
import { DomainError } from '../errors';
import type { SdkEventMap } from '../events';
import { type Currency, Money } from '../types/money';
import type { CashuAccount, SparkAccount } from '../types/account';
import type { CashuSendQuote } from '../types/cashu';
import type { SparkSendQuote } from '../types/spark';

// -- Helpers --------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/**
 * Assert a captured event matches the expected name + payload. `Money` payload fields are compared
 * by VALUE (`.toString()`), since two equal `Money` instances are distinct objects that bun's
 * `toEqual` treats as unequal.
 */
function expectEvent(
  captured: { event: keyof SdkEventMap; data: unknown }[],
  index: number,
  expected: { event: keyof SdkEventMap } & Record<string, unknown>,
): void {
  const actual = captured[index];
  expect(actual).toBeDefined();
  expect(actual?.event).toBe(expected.event);
  const data = actual?.data as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'event') continue;
    if (value instanceof Money) {
      expect((data[key] as Money).toString()).toBe(value.toString());
    } else {
      expect(data[key]).toEqual(value);
    }
  }
}

/** A fake cashu account whose wallet methods the tested paths don't reach (only `.mintUrl`/`.id` used). */
const cashuAccount = (id = 'acc-cashu'): CashuAccount =>
  ({
    id,
    type: 'cashu',
    mintUrl: 'https://mint.test',
    currency: 'BTC',
    proofs: [],
    wallet: {},
  }) as unknown as CashuAccount;

const sparkAccount = (id = 'acc-spark'): SparkAccount =>
  ({
    id,
    type: 'spark',
    currency: 'BTC',
    wallet: {},
  }) as unknown as SparkAccount;

/** A melt-quote update in a given state (only the fields the machines read). */
const meltUpdate = (
  quote: string,
  state: MeltQuoteState,
  overrides: { expiry?: number; amount?: number } = {},
) =>
  ({
    quote,
    state,
    amount: overrides.amount ?? 100,
    fee_reserve: 1,
    expiry: overrides.expiry ?? Math.floor(Date.now() / 1000) + 3600,
  }) as never;

const mintUpdate = (quote: string, state: MintQuoteState) =>
  ({ quote, state, request: 'lnbc1...', unit: 'sat' }) as never;

/** Build an Orchestrator over a deps object whose unused members are inert. */
function makeOrchestrator(overrides: Partial<OrchestratorDeps>): {
  orchestrator: Orchestrator;
  events: TypedEventEmitter<SdkEventMap>;
  captured: { event: keyof SdkEventMap; data: unknown }[];
} {
  const events = new TypedEventEmitter<SdkEventMap>();
  const captured: { event: keyof SdkEventMap; data: unknown }[] = [];
  for (const name of [
    'send:pending',
    'send:completed',
    'send:failed',
    'receive:completed',
    'receive:expired',
    'receive:failed',
  ] as (keyof SdkEventMap)[]) {
    events.on(name, (data) => captured.push({ event: name, data }));
  }

  const deps = {
    events,
    accounts: { get: mock(async () => null) },
    cashuSendQuoteService: {},
    cashuSendQuoteRepository: {},
    cashuSendSwapService: {},
    cashuSendSwapRepository: {},
    cashuReceiveQuoteService: {},
    cashuReceiveQuoteRepository: {},
    cashuReceiveSwapService: {},
    cashuReceiveSwapRepository: {},
    sparkSendQuoteService: {},
    sparkSendQuoteRepository: {},
    sparkReceiveQuoteService: {},
    sparkReceiveQuoteRepository: {},
    ...overrides,
  } as unknown as OrchestratorDeps;

  // Inject inert subscription managers so kickoff tests don't open real mint WebSockets (the live
  // managers are lift-tested separately; the machine cores are pumped directly via `step*`).
  const unsubscribe = () => {
    /* no-op unsubscribe */
  };
  const noopSub = {
    subscribe: mock(async () => unsubscribe),
    removeQuoteFromSubscription: mock(() => {
      /* no-op */
    }),
    closeAll: mock(async () => {
      /* no-op */
    }),
  } as never;

  const orchestrator = new Orchestrator(deps, {
    melt: noopSub,
    mint: noopSub,
  });
  return { orchestrator, events, captured };
}

const baseSendQuote = (
  over: Partial<CashuSendQuote> & { state: CashuSendQuote['state'] },
): CashuSendQuote =>
  ({
    id: 'sq1',
    userId: 'u1',
    accountId: 'acc-cashu',
    transactionId: 'tx1',
    quoteId: 'melt-1',
    amountReceived: sats(100),
    ...over,
  }) as CashuSendQuote;

const baseSparkQuote = (
  over: Partial<SparkSendQuote> & { state: SparkSendQuote['state'] },
): SparkSendQuote =>
  ({
    id: 'ssq1',
    userId: 'u1',
    accountId: 'acc-spark',
    transactionId: 'tx1',
    amount: sats(100),
    ...over,
  }) as SparkSendQuote;

// -- CASHU lightning SEND ----------------------------------------------------------------------

describe('Orchestrator — cashu lightning send machine', () => {
  test('UNPAID melt update on an UNPAID quote initiates the send (DB-read, not cache)', async () => {
    const quote = baseSendQuote({ state: 'UNPAID' });
    const get = mock(async () => quote);
    const initiateSend = mock(async () => undefined);
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { initiateSend } as never,
    });

    // Register the in-flight quote (what executeQuote does at kickoff) then pump the WS signal.
    await orchestrator.executeCashuSendQuote(quote);
    await orchestrator.stepCashuSendQuote(
      meltUpdate('melt-1', MeltQuoteState.UNPAID),
    );

    // It re-read DB state (executeQuote's account fetch + the step's fetch) and initiated.
    expect(get).toHaveBeenCalled();
    expect(initiateSend).toHaveBeenCalledTimes(1);
  });

  test('PAID melt update completes the send and emits send:completed', async () => {
    const pending = baseSendQuote({ state: 'PENDING' });
    const paid = baseSendQuote({
      state: 'PAID',
      paymentPreimage: 'pre',
      lightningFee: sats(0),
      amountSpent: sats(100),
      totalFee: sats(0),
    });
    const get = mock(async () => pending);
    const completeSendQuote = mock(async () => paid);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { completeSendQuote } as never,
    });
    await orchestrator.executeCashuSendQuote(pending);

    await orchestrator.stepCashuSendQuote(
      meltUpdate('melt-1', MeltQuoteState.PAID),
    );

    expect(completeSendQuote).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expectEvent(captured, 0, {
      event: 'send:completed',
      quoteId: 'sq1',
      transactionId: 'tx1',
      amount: paid.amountReceived,
      protocol: 'cashu',
    });
  });

  test('IDEMPOTENT: a melt update for an untracked quote is a no-op (no DB read, no service call)', async () => {
    const get = mock(async () => null);
    const completeSendQuote = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { completeSendQuote } as never,
    });

    // Never registered via executeQuote → not in the working set.
    await orchestrator.stepCashuSendQuote(
      meltUpdate('unknown-melt', MeltQuoteState.PAID),
    );

    expect(get).not.toHaveBeenCalled();
    expect(completeSendQuote).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  test('IDEMPOTENT: a melt update on an already-PAID DB quote does not re-complete (untracks)', async () => {
    const unpaid = baseSendQuote({ state: 'UNPAID' });
    const paid = baseSendQuote({
      state: 'PAID',
      paymentPreimage: 'p',
      lightningFee: sats(0),
      amountSpent: sats(100),
      totalFee: sats(0),
    });
    // executeQuote tracks the quote (reads only the account); the step then reads PAID (terminal)
    // from the DB → no-op, no re-completion.
    const get = mock(async () => paid);
    const completeSendQuote = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { completeSendQuote } as never,
    });
    await orchestrator.executeCashuSendQuote(unpaid);

    await orchestrator.stepCashuSendQuote(
      meltUpdate('melt-1', MeltQuoteState.PAID),
    );

    expect(completeSendQuote).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  test('a DomainError from initiateSend fails the quote and emits send:failed', async () => {
    const quote = baseSendQuote({ state: 'UNPAID' });
    const get = mock(async () => quote);
    const initiateSend = mock(async () => {
      throw new DomainError('mint rejected');
    });
    const failSendQuote = mock(async () => quote);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { initiateSend, failSendQuote } as never,
    });
    await orchestrator.executeCashuSendQuote(quote);

    await orchestrator.stepCashuSendQuote(
      meltUpdate('melt-1', MeltQuoteState.UNPAID),
    );

    expect(failSendQuote).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event).toBe('send:failed');
  });
});

// -- SPARK lightning SEND ----------------------------------------------------------------------

describe('Orchestrator — spark lightning send machine', () => {
  test('executeQuote initiates an UNPAID quote (→ PENDING) and emits send:pending', async () => {
    const pending = baseSparkQuote({
      state: 'PENDING',
      sparkId: 's',
      sparkTransferId: 't',
      fee: sats(1),
    });
    const initiateSend = mock(async () => pending);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => sparkAccount()) } as never,
      sparkSendQuoteService: { initiateSend } as never,
    });

    const result = await orchestrator.executeSparkSendQuote(
      baseSparkQuote({ state: 'UNPAID' }),
    );

    expect(initiateSend).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('PENDING');
    expect(captured).toEqual([
      {
        event: 'send:pending',
        data: { quoteId: 'ssq1', transactionId: 'tx1', protocol: 'spark' },
      },
    ]);
  });

  test('stepSparkSendCompleted completes a PENDING quote and emits send:completed', async () => {
    const pending = baseSparkQuote({
      state: 'PENDING',
      sparkId: 's',
      sparkTransferId: 't',
      fee: sats(1),
    });
    const get = mock(async () => pending);
    const complete = mock(async () => pending);
    const { orchestrator, captured } = makeOrchestrator({
      sparkSendQuoteRepository: { get } as never,
      sparkSendQuoteService: { complete } as never,
    });

    await orchestrator.stepSparkSendCompleted({
      quoteId: 'ssq1',
      paymentPreimage: 'pre',
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expectEvent(captured, 0, {
      event: 'send:completed',
      quoteId: 'ssq1',
      transactionId: 'tx1',
      amount: pending.amount,
      protocol: 'spark',
    });
  });

  test('IDEMPOTENT: stepSparkSendCompleted on a non-PENDING quote is a no-op', async () => {
    const completed = baseSparkQuote({
      state: 'COMPLETED',
      sparkId: 's',
      sparkTransferId: 't',
      fee: sats(1),
      paymentPreimage: 'p',
    });
    const get = mock(async () => completed);
    const complete = mock(async () => completed);
    const { orchestrator, captured } = makeOrchestrator({
      sparkSendQuoteRepository: { get } as never,
      sparkSendQuoteService: { complete } as never,
    });

    await orchestrator.stepSparkSendCompleted({
      quoteId: 'ssq1',
      paymentPreimage: 'pre',
    });

    expect(complete).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  test('stepSparkSendFailed fails a PENDING quote and emits send:failed', async () => {
    const pending = baseSparkQuote({
      state: 'PENDING',
      sparkId: 's',
      sparkTransferId: 't',
      fee: sats(1),
    });
    const get = mock(async () => pending);
    const fail = mock(async () => pending);
    const { orchestrator, captured } = makeOrchestrator({
      sparkSendQuoteRepository: { get } as never,
      sparkSendQuoteService: { fail } as never,
    });

    await orchestrator.stepSparkSendFailed({
      quoteId: 'ssq1',
      reason: 'payment failed',
    });

    expect(fail).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event).toBe('send:failed');
  });
});

// -- CASHU lightning RECEIVE -------------------------------------------------------------------

describe('Orchestrator — cashu lightning receive machine', () => {
  const receiveQuote = (state: string) =>
    ({
      id: 'rq1',
      type: 'LIGHTNING',
      state,
      accountId: 'acc-cashu',
      transactionId: 'tx1',
      quoteId: 'mint-1',
      amount: sats(100),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }) as never;

  test('PAID mint update completes the receive and emits receive:completed', async () => {
    const unpaid = receiveQuote('UNPAID');
    const completed = receiveQuote('COMPLETED');
    const get = mock(async () => unpaid);
    const completeReceive = mock(async () => ({
      quote: completed,
      account: cashuAccount(),
      addedProofs: [],
    }));
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { completeReceive } as never,
    });
    await orchestrator.startCashuReceiveQuote(unpaid);

    await orchestrator.stepCashuReceiveQuote(
      mintUpdate('mint-1', MintQuoteState.PAID),
    );

    expect(completeReceive).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expectEvent(captured, 0, {
      event: 'receive:completed',
      quoteId: 'rq1',
      transactionId: 'tx1',
      amount: sats(100),
      protocol: 'cashu',
    });
  });

  test('ISSUED mint update re-runs complete (recovery after a killed completion)', async () => {
    const unpaid = receiveQuote('UNPAID');
    const completed = receiveQuote('COMPLETED');
    const get = mock(async () => unpaid);
    const completeReceive = mock(async () => ({
      quote: completed,
      account: cashuAccount(),
      addedProofs: [],
    }));
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { completeReceive } as never,
    });
    await orchestrator.startCashuReceiveQuote(unpaid);

    await orchestrator.stepCashuReceiveQuote(
      mintUpdate('mint-1', MintQuoteState.ISSUED),
    );

    expect(completeReceive).toHaveBeenCalledTimes(1);
  });

  test('UNPAID + past-expiry mint update expires the receive and emits receive:expired', async () => {
    const expiredQuote = {
      id: 'rq1',
      type: 'LIGHTNING',
      state: 'UNPAID',
      accountId: 'acc-cashu',
      transactionId: 'tx1',
      quoteId: 'mint-1',
      amount: sats(100),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    } as never;
    const get = mock(async () => expiredQuote);
    const expire = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { expire } as never,
    });
    await orchestrator.startCashuReceiveQuote(expiredQuote);

    await orchestrator.stepCashuReceiveQuote(
      mintUpdate('mint-1', MintQuoteState.UNPAID),
    );

    expect(expire).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event).toBe('receive:expired');
  });

  test('IDEMPOTENT: a mint update on a COMPLETED DB quote does not re-complete', async () => {
    const unpaid = receiveQuote('UNPAID');
    const completed = receiveQuote('COMPLETED');
    // startCashuReceiveQuote tracks the quote (reads only the account); the step then reads
    // COMPLETED (terminal) from the DB → no-op.
    const get = mock(async () => completed);
    const completeReceive = mock(async () => ({
      quote: completed,
      account: cashuAccount(),
      addedProofs: [],
    }));
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { completeReceive } as never,
    });
    await orchestrator.startCashuReceiveQuote(unpaid);

    await orchestrator.stepCashuReceiveQuote(
      mintUpdate('mint-1', MintQuoteState.PAID),
    );

    expect(completeReceive).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});

// -- SPARK lightning RECEIVE -------------------------------------------------------------------

describe('Orchestrator — spark lightning receive machine', () => {
  const sparkReceive = (state: string) =>
    ({
      id: 'srq1',
      state,
      accountId: 'acc-spark',
      transactionId: 'tx1',
      amount: sats(100),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }) as never;

  test('stepSparkReceiveCompleted completes an UNPAID quote and emits receive:completed', async () => {
    const unpaid = sparkReceive('UNPAID');
    const get = mock(async () => unpaid);
    const complete = mock(async () => unpaid);
    const { orchestrator, captured } = makeOrchestrator({
      sparkReceiveQuoteRepository: { get } as never,
      sparkReceiveQuoteService: { complete } as never,
    });

    await orchestrator.stepSparkReceiveCompleted({
      quoteId: 'srq1',
      paymentPreimage: 'pre',
      sparkTransferId: 'st',
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expectEvent(captured, 0, {
      event: 'receive:completed',
      quoteId: 'srq1',
      transactionId: 'tx1',
      amount: sats(100),
      protocol: 'spark',
    });
  });

  test('IDEMPOTENT: stepSparkReceiveCompleted on a non-UNPAID quote is a no-op', async () => {
    const paid = sparkReceive('PAID');
    const get = mock(async () => paid);
    const complete = mock(async () => paid);
    const { orchestrator, captured } = makeOrchestrator({
      sparkReceiveQuoteRepository: { get } as never,
      sparkReceiveQuoteService: { complete } as never,
    });

    await orchestrator.stepSparkReceiveCompleted({
      quoteId: 'srq1',
      paymentPreimage: 'pre',
      sparkTransferId: 'st',
    });

    expect(complete).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  test('stepSparkReceiveExpired expires an UNPAID quote and emits receive:expired', async () => {
    const unpaid = sparkReceive('UNPAID');
    const get = mock(async () => unpaid);
    const expire = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      sparkReceiveQuoteRepository: { get } as never,
      sparkReceiveQuoteService: { expire } as never,
    });

    await orchestrator.stepSparkReceiveExpired('srq1');

    expect(expire).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event).toBe('receive:expired');
  });
});

// -- CASHU token SEND (swap) -------------------------------------------------------------------

describe('Orchestrator — cashu token send swap machine', () => {
  const swap = (state: string, over: Record<string, unknown> = {}) =>
    ({
      id: 'sw1',
      accountId: 'acc-cashu',
      transactionId: 'tx1',
      amountReceived: sats(100),
      state,
      ...over,
    }) as never;

  test('executeCashuSendSwap swaps a DRAFT swap to PENDING via swapForProofsToSend', async () => {
    const draft = swap('DRAFT', {
      keysetId: 'ks',
      keysetCounter: 0,
      outputAmounts: { send: [], change: [] },
    });
    const pending = swap('PENDING', { tokenHash: 'th', proofsToSend: [] });
    let call = 0;
    const get = mock(async () => (call++ === 0 ? draft : pending));
    const swapForProofsToSend = mock(async () => undefined);
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendSwapRepository: { get } as never,
      cashuSendSwapService: { swapForProofsToSend } as never,
    });

    const result = await orchestrator.executeCashuSendSwap(draft);

    expect(swapForProofsToSend).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('PENDING');
  });

  test('stepCashuSendSwapSpent completes a PENDING swap and emits send:completed', async () => {
    const pending = swap('PENDING', { tokenHash: 'th', proofsToSend: [] });
    const get = mock(async () => pending);
    const complete = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      cashuSendSwapRepository: { get } as never,
      cashuSendSwapService: { complete } as never,
    });

    await orchestrator.stepCashuSendSwapSpent('sw1');

    expect(complete).toHaveBeenCalledTimes(1);
    expectEvent(captured, 0, {
      event: 'send:completed',
      quoteId: 'sw1',
      transactionId: 'tx1',
      amount: sats(100),
      protocol: 'cashu',
    });
  });

  test('IDEMPOTENT: stepCashuSendSwapSpent on a non-PENDING swap is a no-op', async () => {
    const completed = swap('COMPLETED', { tokenHash: 'th', proofsToSend: [] });
    const get = mock(async () => completed);
    const complete = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      cashuSendSwapRepository: { get } as never,
      cashuSendSwapService: { complete } as never,
    });

    await orchestrator.stepCashuSendSwapSpent('sw1');

    expect(complete).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});

// -- CASHU same-mint token RECEIVE (swap) ------------------------------------------------------

describe('Orchestrator — cashu same-mint receive swap machine', () => {
  test('stepCashuReceiveSwap completes a PENDING swap and emits receive:completed', async () => {
    const pendingSwap = {
      tokenHash: 'th1',
      state: 'PENDING',
      accountId: 'acc-cashu',
      userId: 'u1',
    } as never;
    const completedSwap = {
      tokenHash: 'th1',
      state: 'COMPLETED',
      transactionId: 'tx1',
      amountReceived: sats(50),
    };
    const getPending = mock(async () => [pendingSwap]);
    const completeSwap = mock(async () => ({
      swap: completedSwap,
      account: cashuAccount(),
      addedProofs: [],
    }));
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveSwapRepository: { getPending } as never,
      cashuReceiveSwapService: { completeSwap } as never,
    });

    await orchestrator.stepCashuReceiveSwap('th1', 'u1');

    expect(completeSwap).toHaveBeenCalledTimes(1);
    expectEvent(captured, 0, {
      event: 'receive:completed',
      quoteId: 'tx1',
      transactionId: 'tx1',
      amount: sats(50),
      protocol: 'cashu',
    });
  });

  test('IDEMPOTENT: stepCashuReceiveSwap with no matching pending swap is a no-op', async () => {
    const getPending = mock(async () => []);
    const completeSwap = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      cashuReceiveSwapRepository: { getPending } as never,
      cashuReceiveSwapService: { completeSwap } as never,
    });

    await orchestrator.stepCashuReceiveSwap('th-missing', 'u1');

    expect(completeSwap).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });
});

// -- CROSS-ACCOUNT token RECEIVE (melt machine) -----------------------------------------------

describe('Orchestrator — cross-account cashu-token melt machine', () => {
  const tokenReceiveQuote = (
    over: { meltInitiated?: boolean; expiresAt?: string } = {},
  ) =>
    ({
      id: 'crq1',
      type: 'CASHU_TOKEN',
      state: 'UNPAID',
      accountId: 'acc-cashu',
      transactionId: 'tx1',
      quoteId: 'mint-dest-1',
      amount: sats(90),
      expiresAt:
        over.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
      tokenReceiveData: {
        sourceMintUrl: 'https://source-mint.test',
        meltQuoteId: 'src-melt-1',
        tokenAmount: sats(100),
        tokenProofs: [],
        meltInitiated: over.meltInitiated ?? false,
      },
    }) as never;

  test('PENDING source-melt update marks the melt initiated', async () => {
    const quote = tokenReceiveQuote();
    const get = mock(async () => quote);
    const markMeltInitiated = mock(async () => quote);
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { markMeltInitiated } as never,
    });
    await orchestrator.startCashuTokenReceiveQuote(quote);

    await orchestrator.stepCashuTokenReceiveMelt(
      meltUpdate('src-melt-1', MeltQuoteState.PENDING),
    );

    expect(markMeltInitiated).toHaveBeenCalledTimes(1);
  });

  test('UNPAID-again after the melt was initiated FAILS the receive (the melt failed)', async () => {
    const quote = tokenReceiveQuote({ meltInitiated: true });
    const get = mock(async () => quote);
    const fail = mock(async () => undefined);
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { fail } as never,
    });
    await orchestrator.startCashuTokenReceiveQuote(quote);

    await orchestrator.stepCashuTokenReceiveMelt(
      meltUpdate('src-melt-1', MeltQuoteState.UNPAID),
    );

    expect(fail).toHaveBeenCalledTimes(1);
  });

  test('a past-expiry UNPAID source-melt update expires the receive and emits receive:expired', async () => {
    const quote = tokenReceiveQuote({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const get = mock(async () => quote);
    const expire = mock(async () => undefined);
    const { orchestrator, captured } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { expire } as never,
    });
    await orchestrator.startCashuTokenReceiveQuote(quote);

    await orchestrator.stepCashuTokenReceiveMelt(
      meltUpdate('src-melt-1', MeltQuoteState.UNPAID, {
        expiry: Math.floor(Date.now() / 1000) - 10,
      }),
    );

    expect(expire).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event).toBe('receive:expired');
  });

  test('IDEMPOTENT: a melt update for an untracked cross-account quote is a no-op', async () => {
    const get = mock(async () => null);
    const markMeltInitiated = mock(async () => undefined);
    const { orchestrator } = makeOrchestrator({
      cashuReceiveQuoteRepository: { get } as never,
      cashuReceiveQuoteService: { markMeltInitiated } as never,
    });

    await orchestrator.stepCashuTokenReceiveMelt(
      meltUpdate('not-tracked', MeltQuoteState.PENDING),
    );

    expect(get).not.toHaveBeenCalled();
    expect(markMeltInitiated).not.toHaveBeenCalled();
  });
});

// -- Lifecycle ----------------------------------------------------------------------------------

describe('Orchestrator — destroy', () => {
  test('destroy clears the in-flight indices (a later step for a tracked quote is a no-op)', async () => {
    const quote = baseSendQuote({ state: 'UNPAID' });
    const get = mock(async () => quote);
    const initiateSend = mock(async () => undefined);
    const { orchestrator } = makeOrchestrator({
      accounts: { get: mock(async () => cashuAccount()) } as never,
      cashuSendQuoteRepository: { get } as never,
      cashuSendQuoteService: { initiateSend } as never,
    });
    await orchestrator.executeCashuSendQuote(quote);

    await orchestrator.destroy();
    // After destroy the working set is cleared, so the signal resolves nothing.
    await orchestrator.stepCashuSendQuote(
      meltUpdate('melt-1', MeltQuoteState.UNPAID),
    );

    expect(initiateSend).not.toHaveBeenCalled();
  });
});
