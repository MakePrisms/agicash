import { describe, expect, it } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import { createStoreEngine } from './engine';

/** Minimal fake EngineContext. Store construction is lazy (repos are only hit on
 * `toPromise`), so bare repo stubs suffice to build the engine. */
const fakeCtx = () =>
  ({
    events: new EventBus<any>(),
    runtime: {
      accountRepository: { getAllActive: async () => [] },
      mintCache: {},
      protocols: {
        contactRepository: { getAll: async () => [] },
        cashuSendQuoteRepository: { getUnresolved: async () => [] },
        cashuSendSwapRepository: { getUnresolved: async () => [] },
        sparkSendQuoteRepository: { getUnresolved: async () => [] },
        cashuReceiveQuoteRepository: { getPending: async () => [] },
        cashuReceiveSwapRepository: { getPending: async () => [] },
        sparkReceiveQuoteRepository: { getPending: async () => [] },
      },
    },
    config: {},
  }) as any;

describe('createStoreEngine', () => {
  it('builds the four seam fields from ctx', () => {
    const engine = createStoreEngine(fakeCtx(), async () => null);
    expect(typeof engine.runner.runTask).toBe('function');
    expect(typeof engine.workSets.getUnresolvedCashuSendQuotes).toBe(
      'function',
    );
    expect(typeof engine.wallets.getCashuAccount).toBe('function');
    expect(typeof engine.fanout.emit).toBe('function');
    expect(typeof engine.fanout.onCatchUp).toBe('function');
  });

  it('captures the nine resident stores', () => {
    const engine = createStoreEngine(fakeCtx(), async () => null);
    const keys = Object.keys(engine.stores).sort();
    expect(keys).toEqual(
      [
        'accounts',
        'cashuReceiveQuotes',
        'cashuReceiveSwaps',
        'cashuSendQuotes',
        'cashuSendSwaps',
        'contacts',
        'sparkReceiveQuotes',
        'sparkSendQuotes',
        'user',
      ].sort(),
    );
    expect(keys).toHaveLength(9);
    for (const store of Object.values(engine.stores)) {
      expect(typeof store.toPromise).toBe('function');
    }
  });
});
