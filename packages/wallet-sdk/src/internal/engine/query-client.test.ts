import { describe, expect, it } from 'bun:test';
import { createEngineQueryClient } from './query-client';

describe('createEngineQueryClient', () => {
  it('sets explicit headless query defaults (finite-by-policy retry, Infinity staleTime/gcTime)', () => {
    const client = createEngineQueryClient();
    const q = client.getDefaultOptions().queries ?? {};
    expect(q.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(q.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(q.retry).toBe(3); // explicit, NOT the server default of 0
  });

  it('sets runner mutation defaults to always-network (decoupled from onlineManager)', () => {
    const client = createEngineQueryClient();
    const m = client.getDefaultOptions().mutations ?? {};
    expect(m.networkMode).toBe('always');
  });
});
