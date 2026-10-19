import { describe, expect, it } from 'bun:test';
import type { Account, CashuAccount } from '../accounts/account';
import {
  GIVE_UP_RETRY_MS,
  type KeyedSerialQueue,
  createKeyedSerialQueue,
} from '../wallet/task-saga';
import {
  type RecordedTimer,
  createTestStint,
  deferred,
  flush,
} from '../wallet/task-saga-test-kit';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { createCashuSendSwapSaga } from './cashu-send-swap-saga';
import type { CashuSendSwapService } from './cashu-send-swap-service';
import type { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

function cashuAccount(
  id: string,
  mintUrl: string,
  isOnline: boolean,
  version = 1,
): CashuAccount {
  return {
    id,
    type: 'cashu',
    isOnline,
    version,
    currency: 'BTC',
    mintUrl,
  } as CashuAccount;
}

function draftSwap(
  id: string,
  accountId: string,
  version: number,
): CashuSendSwap {
  return {
    id,
    accountId,
    version,
    state: 'DRAFT',
    userId: 'user-1',
  } as CashuSendSwap;
}

function pendingSwap(
  id: string,
  accountId: string,
  version: number,
): PendingCashuSendSwap {
  return {
    id,
    accountId,
    version,
    state: 'PENDING',
    userId: 'user-1',
  } as PendingCashuSendSwap;
}

function terminalSwap(
  id: string,
  accountId: string,
  version: number,
  state: 'COMPLETED' | 'FAILED',
): CashuSendSwap {
  return {
    id,
    accountId,
    version,
    state,
    userId: 'user-1',
  } as CashuSendSwap;
}

type SubscribeCall = {
  mintUrl: string;
  swaps: PendingCashuSendSwap[];
  onSpent: (swap: CashuSendSwap) => void;
};

type SwapCall = {
  swap: CashuSendSwap;
  account: CashuAccount;
  args: unknown[];
};

function recordingQueue(): {
  keys: Array<string | undefined>;
  queue: KeyedSerialQueue;
} {
  const inner = createKeyedSerialQueue();
  const keys: Array<string | undefined> = [];
  return {
    keys,
    queue: {
      enqueue(key, scope, job) {
        keys.push(key);
        inner.enqueue(key, scope, job);
      },
    },
  };
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer | undefined {
  const matches = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  return matches[matches.length - 1];
}

function fireAll(timers: RecordedTimer[], ms: number): void {
  const pending = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  for (const timer of pending) {
    timer.callback();
  }
}

function harness(options?: {
  accounts?: Account[];
  loadAccounts?: (userId: string, signal: AbortSignal) => Promise<Account[]>;
  unresolved?: CashuSendSwap[];
}) {
  const online = cashuAccount('account-online', 'https://mint.example', true);
  const recorded = recordingQueue();
  const kit = createTestStint({
    userId: 'user-1',
    queue: recorded.queue,
    loadAccounts:
      options?.loadAccounts ?? (async () => options?.accounts ?? [online]),
  });
  let unresolved = options?.unresolved ?? [];
  const getUnresolvedCalls: Array<{
    userId: string;
    signal: AbortSignal | undefined;
  }> = [];
  const swapCalls: SwapCall[] = [];
  const completeCalls: Array<{ swap: CashuSendSwap; args: unknown[] }> = [];
  const subscribeCalls: SubscribeCall[] = [];
  let unsubscribeCount = 0;
  let swapImpl: (swap: CashuSendSwap, account: CashuAccount) => Promise<void> =
    async () => undefined;
  let completeImpl: (swap: CashuSendSwap) => Promise<void> = async () =>
    undefined;
  let subscribeImpl: (call: SubscribeCall) => Promise<() => void> =
    async () => () =>
      undefined;
  const saga = createCashuSendSwapSaga({
    getRepository: async () =>
      ({
        getUnresolved: async (
          userId: string,
          callOptions?: { abortSignal?: AbortSignal },
        ) => {
          getUnresolvedCalls.push({
            userId,
            signal: callOptions?.abortSignal,
          });
          return unresolved;
        },
      }) as CashuSendSwapRepository,
    getService: async () =>
      ({
        swapForProofsToSend: async (...args: unknown[]) => {
          const [{ swap, account }] = args as [
            { swap: CashuSendSwap; account: CashuAccount },
          ];
          swapCalls.push({ swap, account, args });
          await swapImpl(swap, account);
        },
        complete: async (...args: unknown[]) => {
          const [swap] = args as [CashuSendSwap];
          completeCalls.push({ swap, args });
          await completeImpl(swap);
        },
      }) as CashuSendSwapService,
    createProofStateManager: () =>
      ({
        subscribe: async (call: SubscribeCall) => {
          subscribeCalls.push(call);
          return subscribeImpl(call);
        },
        unsubscribeAll: () => {
          unsubscribeCount += 1;
        },
      }) as unknown as ProofStateSubscriptionManager,
  });
  saga.start(kit.stint);
  return {
    kit,
    online,
    keys: recorded.keys,
    getUnresolvedCalls,
    swapCalls,
    completeCalls,
    subscribeCalls,
    unsubscribeCount: () => unsubscribeCount,
    setUnresolved: (rows: CashuSendSwap[]) => {
      unresolved = rows;
    },
    setSwap: (
      impl: (swap: CashuSendSwap, account: CashuAccount) => Promise<void>,
    ) => {
      swapImpl = impl;
    },
    setComplete: (impl: (swap: CashuSendSwap) => Promise<void>) => {
      completeImpl = impl;
    },
    setSubscribe: (impl: (call: SubscribeCall) => Promise<() => void>) => {
      subscribeImpl = impl;
    },
  };
}

describe('cashu send swap saga', () => {
  it('(a) loads unresolved swaps for the stint user once on start', async () => {
    const { kit, getUnresolvedCalls } = harness();
    await flush();
    expect(getUnresolvedCalls).toHaveLength(1);
    expect(getUnresolvedCalls[0]?.userId).toBe('user-1');
    expect(getUnresolvedCalls[0]?.signal).toBe(kit.scope.signal);
  });

  it('(b) triggers a DRAFT once per membership and skips an offline account', async () => {
    const offline = cashuAccount(
      'account-offline',
      'https://mint.example',
      false,
    );
    const online = cashuAccount('account-online', 'https://mint.example', true);
    const { kit, swapCalls, setUnresolved } = harness({
      accounts: [offline, online],
      unresolved: [
        draftSwap('swap-offline', 'account-offline', 1),
        draftSwap('swap-1', 'account-online', 1),
      ],
    });
    await flush();
    expect(swapCalls.map((call) => call.swap.id)).toEqual(['swap-1']);
    expect(swapCalls[0]?.account).toBe(online);
    expect(swapCalls[0]?.args).toEqual([
      { swap: swapCalls[0]?.swap, account: online },
    ]);
    kit.events.emit('cashu-send-swap.updated', {
      swap: draftSwap('swap-1', 'account-online', 2),
    });
    await flush();
    expect(swapCalls).toHaveLength(1);
    kit.events.emit('cashu-send-swap.updated', {
      swap: terminalSwap('swap-1', 'account-online', 3, 'COMPLETED'),
    });
    await flush();
    expect(swapCalls).toHaveLength(1);
    setUnresolved([]);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(swapCalls).toHaveLength(1);
    setUnresolved([draftSwap('swap-1', 'account-online', 4)]);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(swapCalls.map((call) => call.swap.id)).toEqual(['swap-1', 'swap-1']);
    expect(swapCalls[1]?.swap.version).toBe(4);
    expect(swapCalls[1]?.account).toBe(online);
  });

  it('(c) does not swap when the draft is pending before the job runs', async () => {
    const online = cashuAccount('account-online', 'https://mint.example', true);
    const gate = deferred<Account[]>();
    const { kit, swapCalls } = harness({
      loadAccounts: () => gate.promise,
      unresolved: [draftSwap('swap-1', 'account-online', 1)],
    });
    await flush();
    expect(swapCalls).toHaveLength(0);
    kit.events.emit('cashu-send-swap.updated', {
      swap: pendingSwap('swap-1', 'account-online', 2),
    });
    gate.resolve([online]);
    await flush();
    expect(swapCalls).toHaveLength(0);
  });

  it('(c2) still swaps on the retry when the account flips offline during the backoff', async () => {
    const online = cashuAccount('account-online', 'https://mint.example', true);
    const offline = cashuAccount(
      'account-online',
      'https://mint.example',
      false,
      2,
    );
    const { kit, swapCalls, setSwap } = harness({
      accounts: [online],
      unresolved: [draftSwap('swap-1', 'account-online', 1)],
    });
    setSwap(async () => {
      throw new Error('mint down');
    });
    await flush();
    expect(swapCalls).toHaveLength(1);
    expect(swapCalls[0]?.account).toBe(online);
    kit.events.emit('account.updated', { account: offline });
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(swapCalls).toHaveLength(2);
    expect(swapCalls[1]?.swap.id).toBe('swap-1');
    expect(swapCalls[1]?.swap.state).toBe('DRAFT');
    expect(swapCalls[1]?.account).toBe(offline);
    expect(swapCalls[1]?.account.isOnline).toBe(false);
    expect(swapCalls[1]?.args).toEqual([
      { swap: swapCalls[1]?.swap, account: offline },
    ]);
  });

  it('(d) subscribes once per mint and again with the larger list', async () => {
    const mintA = 'https://mint-a.example';
    const mintB = 'https://mint-b.example';
    const accountA = cashuAccount('account-a', mintA, true);
    const accountB = cashuAccount('account-b', mintB, true);
    const accountOffline = cashuAccount(
      'account-offline',
      'https://mint-offline.example',
      false,
    );
    const { kit, subscribeCalls } = harness({
      accounts: [accountA, accountB, accountOffline],
      unresolved: [
        pendingSwap('swap-a1', 'account-a', 1),
        pendingSwap('swap-b1', 'account-b', 1),
        pendingSwap('swap-offline', 'account-offline', 1),
      ],
    });
    await flush();
    expect(subscribeCalls).toHaveLength(2);
    expect(subscribeCalls.map((call) => call.mintUrl).sort()).toEqual([
      mintA,
      mintB,
    ]);
    expect(
      subscribeCalls
        .find((call) => call.mintUrl === mintA)
        ?.swaps.map((swap) => swap.id),
    ).toEqual(['swap-a1']);
    expect(
      subscribeCalls
        .find((call) => call.mintUrl === mintB)
        ?.swaps.map((swap) => swap.id),
    ).toEqual(['swap-b1']);
    expect(
      subscribeCalls.some((call) =>
        call.swaps.some((swap) => swap.id === 'swap-offline'),
      ),
    ).toBe(false);
    kit.events.emit('cashu-send-swap.created', {
      swap: pendingSwap('swap-a2', 'account-a', 1),
    });
    await flush();
    expect(subscribeCalls).toHaveLength(4);
    const mintACalls = subscribeCalls.filter((call) => call.mintUrl === mintA);
    expect(mintACalls).toHaveLength(2);
    expect(mintACalls[1]?.swaps.map((swap) => swap.id)).toEqual([
      'swap-a1',
      'swap-a2',
    ]);
    expect(
      subscribeCalls
        .filter((call) => call.mintUrl === mintB)[1]
        ?.swaps.map((swap) => swap.id),
    ).toEqual(['swap-b1']);
  });

  it('(e) retries subscribe six times and then logs the mint failure', async () => {
    const error = new Error('socket down');
    const mintUrl = 'https://mint.example';
    const { kit, subscribeCalls, setSubscribe } = harness({
      accounts: [cashuAccount('account-online', mintUrl, true)],
      unresolved: [pendingSwap('swap-1', 'account-online', 1)],
    });
    setSubscribe(async () => {
      throw error;
    });
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(subscribeCalls).toHaveLength(2);
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    expect(subscribeCalls).toHaveLength(3);
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(subscribeCalls).toHaveLength(4);
    armed(kit.clock.timeouts, 8000)?.callback();
    await flush();
    expect(subscribeCalls).toHaveLength(5);
    armed(kit.clock.timeouts, 16000)?.callback();
    await flush();
    expect(subscribeCalls).toHaveLength(6);
    expect(subscribeCalls.every((call) => call.mintUrl === mintUrl)).toBe(true);
    expect(subscribeCalls[0]?.swaps.map((swap) => swap.id)).toEqual(['swap-1']);
    expect(subscribeCalls[5]?.swaps.map((swap) => swap.id)).toEqual(['swap-1']);
    expect(kit.clock.timeouts.map((timer) => timer.ms)).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ]);
    expect(kit.logger.errorLog).toEqual([
      {
        message: 'Failed to subscribe to proof state updates',
        meta: { cause: error, mintUrl },
      },
    ]);
    expect(
      (kit.logger.errorLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
  });

  it('(f) completes onSpent on the send-swap key after the in-flight draft action', async () => {
    const gate = deferred<void>();
    const online = cashuAccount('account-online', 'https://mint.example', true);
    const { kit, keys, swapCalls, completeCalls, subscribeCalls, setSwap } =
      harness({
        accounts: [online],
        unresolved: [draftSwap('swap-1', 'account-online', 1)],
      });
    setSwap(() => gate.promise);
    await flush();
    expect(swapCalls).toHaveLength(1);
    expect(swapCalls[0]?.swap.id).toBe('swap-1');
    expect(keys).toEqual(['send-swap-swap-1']);
    const pending = pendingSwap('swap-1', 'account-online', 2);
    kit.events.emit('cashu-send-swap.updated', { swap: pending });
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]?.mintUrl).toBe('https://mint.example');
    expect(subscribeCalls[0]?.swaps.map((swap) => swap.id)).toEqual(['swap-1']);
    subscribeCalls[0]?.onSpent(pending);
    await flush();
    expect(completeCalls).toHaveLength(0);
    expect(keys).toEqual(['send-swap-swap-1', 'send-swap-swap-1']);
    gate.resolve();
    await flush();
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.swap).toBe(pending);
    expect(completeCalls[0]?.args).toEqual([pending]);
    expect(swapCalls).toHaveLength(1);
  });

  it('(g) unsubscribes once when the stint ends and ignores a late onSpent', async () => {
    const { kit, completeCalls, subscribeCalls, unsubscribeCount } = harness({
      accounts: [cashuAccount('account-online', 'https://mint.example', true)],
      unresolved: [pendingSwap('swap-1', 'account-online', 1)],
    });
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    expect(unsubscribeCount()).toBe(0);
    kit.cancel();
    expect(unsubscribeCount()).toBe(1);
    subscribeCalls[0]?.onSpent(pendingSwap('swap-1', 'account-online', 1));
    await flush();
    expect(completeCalls).toHaveLength(0);
    expect(unsubscribeCount()).toBe(1);
  });

  it('(h) retries both actions four times and logs each failure', async () => {
    const swapError = new Error('swap failed');
    const completeError = new Error('complete failed');
    const {
      kit,
      swapCalls,
      completeCalls,
      subscribeCalls,
      setSwap,
      setComplete,
    } = harness({
      accounts: [cashuAccount('account-online', 'https://mint.example', true)],
      unresolved: [
        draftSwap('swap-draft', 'account-online', 1),
        pendingSwap('swap-pending', 'account-online', 1),
      ],
    });
    setSwap(async () => {
      throw swapError;
    });
    setComplete(async () => {
      throw completeError;
    });
    await flush();
    expect(swapCalls).toHaveLength(1);
    expect(subscribeCalls).toHaveLength(1);
    subscribeCalls[0]?.onSpent(
      pendingSwap('swap-pending', 'account-online', 1),
    );
    await flush();
    expect(completeCalls).toHaveLength(1);
    fireAll(kit.clock.timeouts, 1000);
    await flush();
    expect(swapCalls).toHaveLength(2);
    expect(completeCalls).toHaveLength(2);
    fireAll(kit.clock.timeouts, 2000);
    await flush();
    expect(swapCalls).toHaveLength(3);
    expect(completeCalls).toHaveLength(3);
    fireAll(kit.clock.timeouts, 4000);
    await flush();
    expect(swapCalls).toHaveLength(4);
    expect(completeCalls).toHaveLength(4);
    expect(swapCalls.every((call) => call.swap.id === 'swap-draft')).toBe(true);
    expect(completeCalls.every((call) => call.swap.id === 'swap-pending')).toBe(
      true,
    );
    expect(completeCalls.every((call) => call.args.length === 1)).toBe(true);
    expect(kit.logger.errorLog).toHaveLength(2);
    expect(kit.logger.errorLog).toContainEqual({
      message: 'Error swapping for proofs to send',
      meta: { cause: swapError, swapId: 'swap-draft' },
    });
    expect(kit.logger.errorLog).toContainEqual({
      message: 'Error completing send swap',
      meta: { cause: completeError, swapId: 'swap-pending' },
    });
  });

  it('(i) re-arms a failed draft on the next connected reload', async () => {
    const error = new Error('mint down');
    const { kit, swapCalls, unsubscribeCount, setSwap } = harness({
      accounts: [cashuAccount('account-online', 'https://mint.example', true)],
      unresolved: [draftSwap('swap-1', 'account-online', 1)],
    });
    setSwap(async () => {
      throw error;
    });
    await flush();
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(swapCalls).toHaveLength(4);
    expect(kit.logger.errorLog).toHaveLength(1);
    expect(unsubscribeCount()).toBe(0);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(unsubscribeCount()).toBe(1);
    expect(swapCalls).toHaveLength(5);
    expect(swapCalls[4]?.swap.id).toBe('swap-1');
    expect(swapCalls[4]?.swap.state).toBe('DRAFT');
    expect(swapCalls[4]?.args).toHaveLength(1);
  });

  it('(i2) re-arms a failed draft when the give-up retry interval fires', async () => {
    const error = new Error('mint down');
    const { kit, swapCalls, getUnresolvedCalls, unsubscribeCount, setSwap } =
      harness({
        accounts: [
          cashuAccount('account-online', 'https://mint.example', true),
        ],
        unresolved: [draftSwap('swap-1', 'account-online', 1)],
      });
    setSwap(async () => {
      throw error;
    });
    await flush();
    const interval = armed(kit.clock.intervals, GIVE_UP_RETRY_MS);
    expect(interval).toBeDefined();
    interval?.callback();
    await flush();
    expect(unsubscribeCount()).toBe(0);
    expect(swapCalls).toHaveLength(1);

    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(swapCalls).toHaveLength(4);
    expect(kit.logger.errorLog).toHaveLength(1);

    interval?.callback();
    await flush();
    expect(unsubscribeCount()).toBe(1);
    expect(swapCalls).toHaveLength(5);
    expect(swapCalls[4]?.swap.id).toBe('swap-1');
    expect(getUnresolvedCalls).toHaveLength(1);
  });

  it('(j) logs an account read failure and does not swap', async () => {
    const error = new Error('accounts down');
    const { kit, swapCalls } = harness({
      loadAccounts: async () => {
        throw error;
      },
      unresolved: [draftSwap('swap-1', 'account-online', 1)],
    });
    await flush();
    expect(swapCalls).toHaveLength(0);
    expect(kit.logger.warnLog).toEqual([
      {
        message: 'Failed to load accounts for task processing',
        meta: { saga: 'cashu-send-swap', cause: error },
      },
    ]);
    expect(
      (kit.logger.warnLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
  });
});
