import { describe, expect, it } from 'bun:test';
import type { Account, CashuAccount } from '../accounts/account';
import { GIVE_UP_RETRY_MS } from '../wallet/task-saga';
import {
  type RecordedTimer,
  createTestStint,
  deferred,
  flush,
} from '../wallet/task-saga-test-kit';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { createCashuReceiveSwapSaga } from './cashu-receive-swap-saga';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';

type CompleteResult = {
  swap: CashuReceiveSwap;
  account: CashuAccount;
  addedProofs: string[];
};

function account(id: string, isOnline: boolean): CashuAccount {
  return {
    id,
    type: 'cashu',
    isOnline,
    version: 1,
    currency: 'BTC',
    mintUrl: 'https://mint.example',
  } as CashuAccount;
}

function swap(
  tokenHash: string,
  accountId: string,
  version: number,
  state: 'PENDING' | 'COMPLETED' = 'PENDING',
): CashuReceiveSwap {
  return {
    tokenHash,
    accountId,
    version,
    state,
    userId: 'user-1',
  } as CashuReceiveSwap;
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer | undefined {
  const matches = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  return matches[matches.length - 1];
}

function harness(options?: {
  accounts?: Account[];
  pending?: CashuReceiveSwap[];
}) {
  const online = account('account-online', true);
  const kit = createTestStint({
    userId: 'user-1',
    loadAccounts: async () => options?.accounts ?? [online],
  });
  let pending = options?.pending ?? [];
  const getPendingCalls: Array<{
    userId: string;
    signal: AbortSignal | undefined;
  }> = [];
  const completeCalls: Array<{
    args: unknown[];
    account: CashuAccount;
    swap: CashuReceiveSwap;
  }> = [];
  let completeImpl: (
    account: CashuAccount,
    swap: CashuReceiveSwap,
  ) => Promise<CompleteResult> = async () => {
    throw new Error('completeSwap was not stubbed');
  };
  const emitted: CashuReceiveSwap[] = [];
  kit.events.on('cashu-receive-swap.updated', ({ swap: updated }) => {
    emitted.push(updated);
  });
  const saga = createCashuReceiveSwapSaga({
    getRepository: async () =>
      ({
        getPending: async (
          userId: string,
          callOptions?: { abortSignal?: AbortSignal },
        ) => {
          getPendingCalls.push({
            userId,
            signal: callOptions?.abortSignal,
          });
          return pending;
        },
      }) as CashuReceiveSwapRepository,
    getService: async () =>
      ({
        completeSwap: async (...args: unknown[]) => {
          const [calledAccount, calledSwap] = args as [
            CashuAccount,
            CashuReceiveSwap,
          ];
          completeCalls.push({
            args,
            account: calledAccount,
            swap: calledSwap,
          });
          return completeImpl(calledAccount, calledSwap);
        },
      }) as CashuReceiveSwapService,
  });
  saga.start(kit.stint);
  return {
    kit,
    online,
    getPendingCalls,
    completeCalls,
    emitted,
    setPending: (rows: CashuReceiveSwap[]) => {
      pending = rows;
    },
    setComplete: (
      impl: (
        account: CashuAccount,
        swap: CashuReceiveSwap,
      ) => Promise<CompleteResult>,
    ) => {
      completeImpl = impl;
    },
  };
}

describe('cashu receive swap saga', () => {
  it('(a) loads pending swaps for the stint user once on start', async () => {
    const { getPendingCalls } = harness();
    await flush();
    expect(getPendingCalls).toHaveLength(1);
    expect(getPendingCalls[0]?.userId).toBe('user-1');
    expect(getPendingCalls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('(b) completes a swap on an online account and skips an offline one', async () => {
    const offline = account('account-offline', false);
    const online = account('account-online', true);
    const { completeCalls, setComplete } = harness({
      accounts: [offline, online],
      pending: [
        swap('hash-offline', 'account-offline', 1),
        swap('hash-online', 'account-online', 1),
      ],
    });
    setComplete(async () => {
      throw new Error('stop after the call');
    });
    await flush();
    expect(completeCalls.map((call) => call.swap.tokenHash)).toEqual([
      'hash-online',
    ]);
    expect(completeCalls[0]?.account).toBe(online);
    expect(completeCalls[0]?.args).toHaveLength(2);
  });

  it('(c) fires once per membership and again when the swap leaves and returns', async () => {
    const { kit, online, completeCalls, setPending, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async (_account, current) => ({
      swap: current,
      account: online,
      addedProofs: [],
    }));
    await flush();
    expect(completeCalls.map((call) => call.swap.tokenHash)).toEqual([
      'hash-1',
    ]);
    kit.events.emit('cashu-receive-swap.updated', {
      swap: swap('hash-1', 'account-online', 2),
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
    kit.events.emit('cashu-receive-swap.updated', {
      swap: swap('hash-1', 'account-online', 3, 'COMPLETED'),
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
    kit.events.emit('cashu-receive-swap.created', {
      swap: swap('hash-2', 'account-online', 1),
    });
    await flush();
    expect(completeCalls.map((call) => call.swap.tokenHash)).toEqual([
      'hash-1',
      'hash-2',
    ]);
    setPending([]);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(completeCalls).toHaveLength(2);
    setPending([swap('hash-2', 'account-online', 2)]);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(completeCalls.map((call) => call.swap.tokenHash)).toEqual([
      'hash-1',
      'hash-2',
      'hash-2',
    ]);
  });

  it('(d) retries completeSwap four times and then logs the failure', async () => {
    const error = new Error('mint down');
    const { kit, completeCalls, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async () => {
      throw error;
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(2);
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(3);
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(4);
    expect(
      completeCalls.every((call) => call.swap.tokenHash === 'hash-1'),
    ).toBe(true);
    expect(kit.clock.timeouts.map((timer) => timer.ms)).toEqual([
      1000, 2000, 4000,
    ]);
    expect(kit.logger.errorLog).toEqual([
      {
        message: 'Error finalizing receive swap',
        meta: { cause: error, tokenHash: 'hash-1' },
      },
    ]);
    expect(
      (kit.logger.errorLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
  });

  it('(e) re-reads the guard on each attempt and skips a swap that completed during the backoff', async () => {
    const { kit, completeCalls, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async () => {
      throw new Error('first attempt');
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
    kit.events.emit('cashu-receive-swap.updated', {
      swap: swap('hash-1', 'account-online', 2, 'COMPLETED'),
    });
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(1);
  });

  it('(f) emits the completed swap once and ignores the echo of that version', async () => {
    const completed = swap('hash-1', 'account-online', 2, 'COMPLETED');
    const { kit, online, completeCalls, emitted, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async () => ({
      swap: completed,
      account: online,
      addedProofs: [],
    }));
    await flush();
    expect(completeCalls).toHaveLength(1);
    expect(emitted).toEqual([completed]);
    expect(emitted[0]).toBe(completed);
    kit.events.emit('cashu-receive-swap.updated', { swap: completed });
    await flush();
    expect(emitted).toEqual([completed, completed]);
    expect(completeCalls).toHaveLength(1);
    kit.events.emit('cashu-receive-swap.updated', {
      swap: swap('hash-1', 'account-online', 2),
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
  });

  it('(g) does not emit after the stint is cancelled, and passes no signal to completeSwap', async () => {
    const gate = deferred<CompleteResult>();
    const completed = swap('hash-1', 'account-online', 2, 'COMPLETED');
    const { kit, online, completeCalls, emitted, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(() => gate.promise);
    await flush();
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.args).toHaveLength(2);
    expect(completeCalls[0]?.account).toBe(online);
    expect(completeCalls[0]?.swap.tokenHash).toBe('hash-1');
    expect(
      completeCalls[0]?.args.some((arg) => arg instanceof AbortSignal),
    ).toBe(false);
    kit.cancel();
    gate.resolve({
      swap: completed,
      account: online,
      addedProofs: [],
    });
    await flush();
    expect(emitted).toHaveLength(0);
    expect(completeCalls).toHaveLength(1);
  });

  it('(h) reloads on connect and on activation', async () => {
    const { kit, getPendingCalls } = harness();
    await flush();
    expect(getPendingCalls).toHaveLength(1);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(getPendingCalls).toHaveLength(2);
    kit.activity.setActive(false);
    kit.activity.notify();
    await flush();
    expect(getPendingCalls).toHaveLength(2);
    kit.activity.setActive(true);
    kit.activity.notify();
    await flush();
    expect(getPendingCalls).toHaveLength(3);
  });

  it('(i) calls completeSwap again for the same swap after a failed give-up and a connected reload', async () => {
    const error = new Error('mint down');
    const { kit, completeCalls, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async () => {
      throw error;
    });
    await flush();
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(4);
    expect(kit.logger.errorLog).toHaveLength(1);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(completeCalls).toHaveLength(5);
    expect(completeCalls[4]?.swap.tokenHash).toBe('hash-1');
    expect(completeCalls[4]?.args).toHaveLength(2);
  });

  it('(j) calls completeSwap again after a give-up when the give-up retry interval fires', async () => {
    const error = new Error('mint down');
    const { kit, completeCalls, getPendingCalls, setComplete } = harness({
      pending: [swap('hash-1', 'account-online', 1)],
    });
    setComplete(async () => {
      throw error;
    });
    await flush();
    const interval = armed(kit.clock.intervals, GIVE_UP_RETRY_MS);
    expect(interval).toBeDefined();
    interval?.callback();
    await flush();
    expect(completeCalls).toHaveLength(1);

    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(completeCalls).toHaveLength(4);
    expect(kit.logger.errorLog).toHaveLength(1);

    interval?.callback();
    await flush();
    expect(completeCalls).toHaveLength(5);
    expect(completeCalls[4]?.swap.tokenHash).toBe('hash-1');
    expect(getPendingCalls).toHaveLength(1);
  });
});
