import { describe, expect, it, mock } from 'bun:test';
import { MintQuoteTracker } from './mint-quote-tracker';

describe('MintQuoteTracker.dispose', () => {
  it('forwards to manager.disposeAll', () => {
    const disposeAll = mock(async () => {});
    const tracker = new MintQuoteTracker();
    // @ts-expect-error — inject spy manager
    tracker.manager = { disposeAll };

    tracker.dispose();

    expect(disposeAll).toHaveBeenCalledTimes(1);
  });
});
