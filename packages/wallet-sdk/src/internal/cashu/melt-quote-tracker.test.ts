import { describe, expect, it, mock } from 'bun:test';
import { MeltQuoteTracker } from './melt-quote-tracker';

describe('MeltQuoteTracker.dispose', () => {
  it('forwards to manager.disposeAll', () => {
    const disposeAll = mock(async () => {});
    const tracker = new MeltQuoteTracker();
    // @ts-expect-error — inject spy manager
    tracker.manager = { disposeAll };

    tracker.dispose();

    expect(disposeAll).toHaveBeenCalledTimes(1);
  });
});
