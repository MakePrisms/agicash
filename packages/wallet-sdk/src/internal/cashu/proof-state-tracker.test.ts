import { describe, expect, it, mock } from 'bun:test';
import { ProofStateTracker } from './proof-state-tracker';

describe('ProofStateTracker.dispose', () => {
  it('forwards to manager.disposeAll', () => {
    const disposeAll = mock(async () => {});
    const tracker = new ProofStateTracker();
    // @ts-expect-error — inject spy manager
    tracker.manager = { disposeAll };

    tracker.dispose();

    expect(disposeAll).toHaveBeenCalledTimes(1);
  });
});
