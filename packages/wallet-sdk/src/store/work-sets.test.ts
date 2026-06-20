import { describe, expect, it, mock } from 'bun:test';
import { createWorkSets } from './work-sets';

const fakeStore = (data: any[]) => ({
  get: () => data,
  toPromise: mock(async () => data),
  subscribe: () => () => {},
  set: () => {},
});

const accountsStore = (online: Record<string, boolean>) =>
  ({
    get: () =>
      Object.entries(online).map(([id, isOnline]) => ({ id, isOnline })),
    toPromise: mock(async () =>
      Object.entries(online).map(([id, isOnline]) => ({ id, isOnline })),
    ),
    subscribe: () => () => {},
    set: () => {},
  }) as any;

describe('createWorkSets', () => {
  it('keeps only items whose account is online, after awaiting both stores', async () => {
    const stores = {
      accounts: accountsStore({ on: true, off: false }),
      cashuSendQuotes: fakeStore([
        { id: 'q1', accountId: 'on' },
        { id: 'q2', accountId: 'off' },
        { id: 'q3', accountId: 'missing' },
      ]),
      cashuSendSwaps: fakeStore([]),
      sparkSendQuotes: fakeStore([]),
      cashuReceiveQuotes: fakeStore([]),
      cashuReceiveSwaps: fakeStore([]),
      sparkReceiveQuotes: fakeStore([]),
    } as any;
    const ws = createWorkSets(stores);
    const result = await ws.getUnresolvedCashuSendQuotes('u1');
    expect(result.map((q: any) => q.id)).toEqual(['q1']);
    expect(stores.accounts.toPromise).toHaveBeenCalled(); // load-before-serve
    expect(stores.cashuSendQuotes.toPromise).toHaveBeenCalled();
  });

  it('exposes all 6 WorkSetSource methods returning arrays', async () => {
    const empty = () => fakeStore([]);
    const stores = {
      accounts: accountsStore({}),
      cashuSendQuotes: empty(),
      cashuSendSwaps: empty(),
      sparkSendQuotes: empty(),
      cashuReceiveQuotes: empty(),
      cashuReceiveSwaps: empty(),
      sparkReceiveQuotes: empty(),
    } as any;
    const ws = createWorkSets(stores);
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
