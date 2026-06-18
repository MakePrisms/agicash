import { describe, expect, mock, test } from 'bun:test';
import { type Processors, ProcessorRegistry } from './processor-registry';
import type { Processor } from './processors/processor';

type StubProcessor = Processor & {
  lastIsCurrent: (() => boolean) | undefined;
  reloadCalls: number;
};

const makeStubProcessor = (): StubProcessor => {
  const stub: StubProcessor = {
    lastIsCurrent: undefined,
    reloadCalls: 0,
    reload: mock(async (_userId: string, isCurrent?: () => boolean) => {
      stub.lastIsCurrent = isCurrent;
      stub.reloadCalls += 1;
    }),
    dispose: mock(() => {}),
  };
  return stub;
};

const makeStubProcessors = (): Record<keyof Processors, StubProcessor> => ({
  cashuSendQuote: makeStubProcessor(),
  cashuSendSwap: makeStubProcessor(),
  sparkSendQuote: makeStubProcessor(),
  cashuReceiveQuote: makeStubProcessor(),
  cashuReceiveSwap: makeStubProcessor(),
  sparkReceiveQuote: makeStubProcessor(),
});

describe('ProcessorRegistry leader epoch', () => {
  test('passes an isCurrent predicate into every processor.reload on activate', () => {
    const procs = makeStubProcessors();
    const registry = new ProcessorRegistry(procs);

    registry.activate('u1');

    for (const proc of Object.values(procs)) {
      expect(proc.reloadCalls).toBe(1);
      expect(typeof proc.lastIsCurrent).toBe('function');
      expect(proc.lastIsCurrent?.()).toBe(true);
    }
  });

  test('bumps the leader epoch on activate AND deactivate', () => {
    const procs = makeStubProcessors();
    const registry = new ProcessorRegistry(procs);

    registry.activate('u1');
    const isCurrentAtActivate = procs.cashuReceiveQuote.lastIsCurrent;
    expect(isCurrentAtActivate?.()).toBe(true);

    registry.deactivate();
    // The epoch moved on deactivate, so the predicate captured at activate is now stale.
    expect(isCurrentAtActivate?.()).toBe(false);
  });

  test('a predicate captured under one leadership is stale after re-activate', () => {
    const procs = makeStubProcessors();
    const registry = new ProcessorRegistry(procs);

    registry.activate('u1');
    const isCurrentEpoch1 = procs.cashuReceiveQuote.lastIsCurrent;
    expect(isCurrentEpoch1?.()).toBe(true);

    registry.deactivate();
    registry.activate('u2');

    // A new epoch was opened by the re-activate; the epoch-1 predicate is stale.
    expect(isCurrentEpoch1?.()).toBe(false);
    // The freshly captured predicate is current.
    expect(procs.cashuReceiveQuote.lastIsCurrent?.()).toBe(true);
  });
});
