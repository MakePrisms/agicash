import { describe, expect, it, mock } from 'bun:test';
import { createWorkSets } from './work-sets';

const makeAccounts = (online: Record<string, boolean>) =>
  ({
    ensureLoaded: mock(async () => {}),
    isOnline: (id: string) => online[id] === true,
  }) as any;

const makeRuntime = (sendQuotes: any[]) =>
  ({
    protocols: {
      cashuSendQuoteRepository: { getUnresolved: mock(async () => sendQuotes) },
      cashuSendSwapRepository: { getUnresolved: mock(async () => []) },
      sparkSendQuoteRepository: { getUnresolved: mock(async () => []) },
      cashuReceiveQuoteRepository: { getPending: mock(async () => []) },
      cashuReceiveSwapRepository: { getPending: mock(async () => []) },
      sparkReceiveQuoteRepository: { getPending: mock(async () => []) },
    },
  }) as any;

describe('createWorkSets', () => {
  it('reads the repo then keeps only items whose account is online', async () => {
    const accounts = makeAccounts({ on: true, off: false });
    const runtime = makeRuntime([
      { id: 'q1', accountId: 'on' },
      { id: 'q2', accountId: 'off' },
      { id: 'q3', accountId: 'missing' },
    ]);
    const ws = createWorkSets(runtime, accounts);
    const result = await ws.getUnresolvedCashuSendQuotes('u1');
    expect(result.map((q: any) => q.id)).toEqual(['q1']);
    expect(accounts.ensureLoaded).toHaveBeenCalledWith('u1');
  });

  it('exposes all 6 WorkSetSource methods returning arrays', async () => {
    const ws = createWorkSets(makeRuntime([]), makeAccounts({}));
    for (const m of [
      'getUnresolvedCashuSendQuotes',
      'getUnresolvedCashuSendSwaps',
      'getUnresolvedSparkSendQuotes',
      'getPendingCashuReceiveQuotes',
      'getPendingCashuReceiveSwaps',
      'getPendingSparkReceiveQuotes',
    ] as const) {
      expect(Array.isArray(await (ws as any)[m]('u1'))).toBe(true);
    }
  });
});
