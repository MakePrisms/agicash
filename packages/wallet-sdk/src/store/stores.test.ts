import { describe, expect, it, mock } from 'bun:test';
import { createEngineQueryClient } from '../internal/engine';
import { allStores, createStoreRegistry } from './stores';

const user = { id: 'u1', defaultCurrency: 'BTC' } as any;

const makeRuntime = (over: Record<string, unknown> = {}) =>
  ({
    accountRepository: { getAllActive: mock(async () => [{ id: 'a1' }]) },
    protocols: {
      contactRepository: { getAll: mock(async () => [{ id: 'c1' }]) },
      cashuSendQuoteRepository: {
        getUnresolved: mock(async () => [{ id: 'q1' }]),
      },
      cashuSendSwapRepository: { getUnresolved: mock(async () => []) },
      sparkSendQuoteRepository: { getUnresolved: mock(async () => []) },
      cashuReceiveQuoteRepository: { getPending: mock(async () => []) },
      cashuReceiveSwapRepository: { getPending: mock(async () => []) },
      sparkReceiveQuoteRepository: { getPending: mock(async () => []) },
    },
    ...over,
  }) as any;

describe('createStoreRegistry', () => {
  it('user store seeds from getUser', async () => {
    const reg = createStoreRegistry(
      makeRuntime(),
      createEngineQueryClient(),
      async () => user,
    );
    expect(await reg.user.toPromise()).toEqual(user);
  });

  it('accounts store seeds via accountRepository.getAllActive(userId)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(
      runtime,
      createEngineQueryClient(),
      async () => user,
    );
    expect((await reg.accounts.toPromise()).map((a: any) => a.id)).toEqual([
      'a1',
    ]);
    expect(runtime.accountRepository.getAllActive).toHaveBeenCalledWith('u1');
  });

  it('quote stores seed via the matching repo method (send=getUnresolved, receive=getPending)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(
      runtime,
      createEngineQueryClient(),
      async () => user,
    );
    expect(
      (await reg.cashuSendQuotes.toPromise()).map((q: any) => q.id),
    ).toEqual(['q1']);
    expect(
      runtime.protocols.cashuSendQuoteRepository.getUnresolved,
    ).toHaveBeenCalledWith('u1');
  });

  it('returns empty (no repo call) when signed out (getUser -> null)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(
      runtime,
      createEngineQueryClient(),
      async () => null,
    );
    expect(await reg.accounts.toPromise()).toEqual([]);
    expect(await reg.user.toPromise()).toBeNull();
    expect(runtime.accountRepository.getAllActive).not.toHaveBeenCalled();
  });

  it('allStores returns all nine', () => {
    const reg = createStoreRegistry(
      makeRuntime(),
      createEngineQueryClient(),
      async () => null,
    );
    expect(allStores(reg)).toHaveLength(9);
  });
});
