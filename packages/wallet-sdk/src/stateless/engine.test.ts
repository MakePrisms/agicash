import { describe, expect, it } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import { createStatelessEngine } from './engine';
import { createStatelessSdk } from './index';

describe('createStatelessEngine', () => {
  it('builds the four engine pieces from ctx', () => {
    const ctx = {
      events: new EventBus<any>(),
      runtime: {
        accountRepository: { getAllActive: async () => [] },
        mintCache: {},
        mintAuth: {},
        protocols: {
          cashuSendQuoteRepository: { getUnresolved: async () => [] },
          cashuSendSwapRepository: { getUnresolved: async () => [] },
          sparkSendQuoteRepository: { getUnresolved: async () => [] },
          cashuReceiveQuoteRepository: { getPending: async () => [] },
          cashuReceiveSwapRepository: { getPending: async () => [] },
          sparkReceiveQuoteRepository: { getPending: async () => [] },
        },
      },
      config: {},
    } as any;
    const engine = createStatelessEngine(ctx);
    expect(typeof engine.runner.runTask).toBe('function');
    expect(typeof engine.workSets.getUnresolvedCashuSendQuotes).toBe(
      'function',
    );
    expect(typeof engine.wallets.getCashuAccount).toBe('function');
    expect(typeof engine.fanout.emit).toBe('function');
    expect(typeof engine.fanout.onCatchUp).toBe('function');
  });
});

describe('createStatelessSdk', () => {
  it('is an async client-entry factory', () => {
    expect(typeof createStatelessSdk).toBe('function');
  });
});
