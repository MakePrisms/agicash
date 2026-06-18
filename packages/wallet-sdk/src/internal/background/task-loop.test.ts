import { describe, expect, it, mock } from 'bun:test';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import { TaskLoop } from './task-loop';

const unresolvedCashuSend = [{ id: 'cs-1', state: 'UNPAID', accountId: 'a' }];
const unresolvedCashuSwap = [
  { id: 'css-1', state: 'DRAFT' },
  { id: 'css-2', state: 'PENDING' },
];
const pendingCashuReceive = [
  { id: 'crq-1', type: 'LIGHTNING', state: 'UNPAID' },
  { id: 'crq-2', type: 'CASHU_TOKEN', state: 'UNPAID' },
];
const pendingCashuReceiveSwap = [{ tokenHash: 'h', state: 'PENDING' }];
const unresolvedSparkSend = [{ id: 'ss-1', state: 'UNPAID' }];
const pendingSparkReceive = [
  { id: 'srq-1', type: 'LIGHTNING', state: 'UNPAID' },
];

function setup() {
  const calls: string[] = [];
  const repos = {
    cashuSendQuote: { getUnresolved: mock(async () => unresolvedCashuSend) },
    cashuSendSwap: { getUnresolved: mock(async () => unresolvedCashuSwap) },
    cashuReceiveQuote: { getPending: mock(async () => pendingCashuReceive) },
    cashuReceiveSwap: { getPending: mock(async () => pendingCashuReceiveSwap) },
    sparkSendQuote: { getUnresolved: mock(async () => unresolvedSparkSend) },
    sparkReceiveQuote: { getPending: mock(async () => pendingSparkReceive) },
  };

  const sparkSendCleanup = mock(() => undefined);
  const sparkReceiveCleanup = mock(() => undefined);
  const orchestrators = {
    cashuSend: {
      reconcile: mock(async () => {
        calls.push('cashuSend.reconcile');
      }),
    },
    cashuSendSwap: {
      processDrafts: mock(async () => {
        calls.push('cashuSendSwap.processDrafts');
      }),
      reconcile: mock(async () => {
        calls.push('cashuSendSwap.reconcile');
      }),
    },
    cashuReceiveQuote: {
      reconcileMintQuotes: mock(async () => {
        calls.push('cashuReceiveQuote.reconcileMintQuotes');
      }),
      reconcileCrossMintMelts: mock(async () => {
        calls.push('cashuReceiveQuote.reconcileCrossMintMelts');
      }),
    },
    cashuReceiveSwap: {
      processPending: mock(async () => {
        calls.push('cashuReceiveSwap.processPending');
      }),
    },
    sparkSend: { reconcile: mock(async () => sparkSendCleanup) },
    sparkReceive: {
      reconcile: mock(async () => sparkReceiveCleanup),
      reconcileCrossMintMelts: mock(async () => undefined),
      applyExpiry: mock(async () => undefined),
    },
  };

  const loop = new TaskLoop({
    repos: repos as never,
    orchestrators: orchestrators as never,
    cashuReceiveQuoteService: { expire: mock(async () => undefined) } as never,
    cashuSendQuoteService: {
      expireSendQuote: mock(async () => undefined),
    } as never,
    initiateMelt: mock(async () => undefined),
    getUserId: mock(async () => 'user-1'),
    emitter: new SdkEventEmitter<SdkEventMap>(),
  });
  return {
    loop,
    repos,
    orchestrators,
    calls,
    sparkSendCleanup,
    sparkReceiveCleanup,
  };
}

describe('TaskLoop.runOnce', () => {
  it('no-ops when there is no user', async () => {
    const { loop, orchestrators } = setup();
    (
      loop as unknown as { deps: { getUserId: () => Promise<string | null> } }
    ).deps.getUserId = mock(async () => null);
    await loop.runOnce();
    expect(orchestrators.cashuSend.reconcile).not.toHaveBeenCalled();
  });

  it('drives every orchestrator with its work-list', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    expect(orchestrators.cashuSend.reconcile).toHaveBeenCalledWith(
      unresolvedCashuSend,
    );
    expect(orchestrators.cashuSendSwap.processDrafts).toHaveBeenCalledWith(
      unresolvedCashuSwap,
    );
    expect(orchestrators.cashuSendSwap.reconcile).toHaveBeenCalledWith([
      { id: 'css-2', state: 'PENDING' },
    ]);
    expect(
      orchestrators.cashuReceiveQuote.reconcileMintQuotes,
    ).toHaveBeenCalledWith(pendingCashuReceive);
    expect(
      orchestrators.cashuReceiveQuote.reconcileCrossMintMelts,
    ).toHaveBeenCalled();
    expect(orchestrators.cashuReceiveSwap.processPending).toHaveBeenCalledWith(
      pendingCashuReceiveSwap,
    );
    expect(orchestrators.sparkSend.reconcile).toHaveBeenCalledWith(
      unresolvedSparkSend,
    );
    expect(orchestrators.sparkReceive.reconcile).toHaveBeenCalledWith(
      pendingSparkReceive,
    );
  });

  it('passes only CASHU_TOKEN receive quotes to reconcileCrossMintMelts', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    const arg = (
      orchestrators.cashuReceiveQuote.reconcileCrossMintMelts as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0][0] as { type: string }[];
    expect(arg.every((q) => q.type === 'CASHU_TOKEN')).toBe(true);
  });

  it('disposes the prior tick spark thunks before re-reconciling', async () => {
    const { loop, sparkSendCleanup, sparkReceiveCleanup } = setup();
    await loop.runOnce(); // captures thunks
    await loop.runOnce(); // should dispose the prior ones first
    expect(sparkSendCleanup).toHaveBeenCalledTimes(1);
    expect(sparkReceiveCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes the prior tick spark thunks even on a no-user tick (logout)', async () => {
    const { loop, sparkSendCleanup, sparkReceiveCleanup } = setup();
    await loop.runOnce(); // captures thunks (user present)
    (
      loop as unknown as { deps: { getUserId: () => Promise<string | null> } }
    ).deps.getUserId = mock(async () => null);
    await loop.runOnce(); // no user → must still dispose the prior thunks
    expect(sparkSendCleanup).toHaveBeenCalledTimes(1);
    expect(sparkReceiveCleanup).toHaveBeenCalledTimes(1);
  });

  it('dispose() invokes the held spark thunks', async () => {
    const { loop, sparkSendCleanup, sparkReceiveCleanup } = setup();
    await loop.runOnce();
    loop.dispose();
    expect(sparkSendCleanup).toHaveBeenCalledTimes(1);
    expect(sparkReceiveCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('TaskLoop.runOnce expiry sweep', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  it('expires an UNPAID+expired cashu send quote (no event)', async () => {
    const { loop, repos, orchestrators } = setup();
    (
      repos.cashuSendQuote.getUnresolved as unknown as {
        mockImplementation: (f: () => Promise<unknown>) => void;
      }
    ).mockImplementation(async () => [
      { id: 'cs-x', state: 'UNPAID', accountId: 'a', expiresAt: past },
    ]);
    const expireSendQuote = (
      loop as unknown as {
        deps: {
          cashuSendQuoteService: { expireSendQuote: ReturnType<typeof mock> };
        };
      }
    ).deps.cashuSendQuoteService.expireSendQuote;
    await loop.runOnce();
    expect(expireSendQuote).toHaveBeenCalledTimes(1);
    expect(orchestrators.cashuSend.reconcile).toHaveBeenCalled(); // reconcile still runs
  });

  it('expires an UNPAID+expired cashu receive quote and emits receive:expired', async () => {
    const { loop, repos } = setup();
    const emitter = (
      loop as unknown as { deps: { emitter: SdkEventEmitter<SdkEventMap> } }
    ).deps.emitter;
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    (
      repos.cashuReceiveQuote.getPending as unknown as {
        mockImplementation: (f: () => Promise<unknown>) => void;
      }
    ).mockImplementation(async () => [
      { id: 'crq-x', type: 'LIGHTNING', state: 'UNPAID', expiresAt: past },
    ]);
    await loop.runOnce();
    expect(expired).toEqual([{ quoteId: 'crq-x', protocol: 'cashu' }] as never);
  });

  it('does NOT expire a not-yet-expired cashu receive quote', async () => {
    const { loop, repos } = setup();
    const emitter = (
      loop as unknown as { deps: { emitter: SdkEventEmitter<SdkEventMap> } }
    ).deps.emitter;
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    (
      repos.cashuReceiveQuote.getPending as unknown as {
        mockImplementation: (f: () => Promise<unknown>) => void;
      }
    ).mockImplementation(async () => [
      { id: 'crq-y', type: 'LIGHTNING', state: 'UNPAID', expiresAt: future },
    ]);
    await loop.runOnce();
    expect(expired).toHaveLength(0);
  });

  it('runs spark applyExpiry for each pending spark receive quote', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    expect(orchestrators.sparkReceive.applyExpiry).toHaveBeenCalledTimes(
      pendingSparkReceive.length,
    );
  });
});
