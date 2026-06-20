import { describe, expect, it, mock } from 'bun:test';
import { createFanout } from './fanout';

const listStore = (initial: any[] = []) => {
  let data = initial;
  return {
    get: () => data,
    set: (u: any) => {
      data = typeof u === 'function' ? u(data) : u;
    },
    toPromise: mock(async () => data),
    subscribe: () => () => {},
    _data: () => data,
  };
};
const singleStore = (initial: any = null) => {
  let data = initial;
  return {
    get: () => data,
    set: (u: any) => {
      data = typeof u === 'function' ? u(data) : u;
    },
    toPromise: mock(async () => data),
    subscribe: () => () => {},
    _data: () => data,
  };
};

const makeStores = () =>
  ({
    user: singleStore(),
    accounts: listStore(),
    contacts: listStore(),
    cashuSendQuotes: listStore(),
    cashuSendSwaps: listStore(),
    sparkSendQuotes: listStore(),
    cashuReceiveQuotes: listStore(),
    cashuReceiveSwaps: listStore(),
    sparkReceiveQuotes: listStore(),
  }) as any;

describe('createFanout', () => {
  it('account upsert writes the store (keep active)', () => {
    const s = makeStores();
    createFanout(s).emit({
      kind: 'account',
      operation: 'created',
      entity: { id: 'a1', state: 'active', version: 1 },
    } as any);
    expect(s.accounts._data()).toEqual([
      { id: 'a1', state: 'active', version: 1 },
    ]);
  });

  it('account update is version-gated (stale skipped)', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({
      kind: 'account',
      operation: 'created',
      entity: { id: 'a1', state: 'active', version: 5 },
    } as any);
    f.emit({
      kind: 'account',
      operation: 'updated',
      entity: { id: 'a1', state: 'active', version: 3 },
    } as any); // stale
    expect(s.accounts._data()[0].version).toBe(5);
  });

  it('account flipping to expired is REMOVED from the store', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({
      kind: 'account',
      operation: 'created',
      entity: { id: 'a1', state: 'active', version: 1 },
    } as any);
    f.emit({
      kind: 'account',
      operation: 'updated',
      entity: { id: 'a1', state: 'expired', version: 2 },
    } as any);
    expect(s.accounts._data()).toEqual([]);
  });

  it('cashu-send-quote leaving the keep-set (UNPAID/PENDING) is removed', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({
      kind: 'cashu-send-quote',
      operation: 'created',
      entity: { id: 'q1', state: 'PENDING', accountId: 'a', version: 1 },
    } as any);
    expect(s.cashuSendQuotes._data()).toHaveLength(1);
    f.emit({
      kind: 'cashu-send-quote',
      operation: 'updated',
      entity: { id: 'q1', state: 'PAID', accountId: 'a', version: 2 },
    } as any);
    expect(s.cashuSendQuotes._data()).toEqual([]); // PAID not in {UNPAID,PENDING}
  });

  it('cashu-receive-swap keeps only PENDING (keyed by tokenHash)', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({
      kind: 'cashu-receive-swap',
      operation: 'created',
      entity: { tokenHash: 't1', state: 'PENDING', accountId: 'a', version: 1 },
    } as any);
    expect(s.cashuReceiveSwaps._data()).toHaveLength(1);
    f.emit({
      kind: 'cashu-receive-swap',
      operation: 'updated',
      entity: {
        tokenHash: 't1',
        state: 'COMPLETED',
        accountId: 'a',
        version: 2,
      },
    } as any);
    expect(s.cashuReceiveSwaps._data()).toEqual([]);
  });

  it('cashu-receive-swap update is version-gated by tokenHash (stale skipped)', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({
      kind: 'cashu-receive-swap',
      operation: 'created',
      entity: { tokenHash: 't1', state: 'PENDING', accountId: 'a', version: 5 },
    } as any);
    f.emit({
      kind: 'cashu-receive-swap',
      operation: 'updated',
      entity: { tokenHash: 't1', state: 'PENDING', accountId: 'a', version: 3 },
    } as any); // stale
    expect(s.cashuReceiveSwaps._data()).toHaveLength(1);
    expect(s.cashuReceiveSwaps._data()[0].version).toBe(5);
  });

  it('user overwrites; contacts add/remove; transaction is a no-op', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'user', operation: 'updated', entity: { id: 'u1' } } as any);
    expect(s.user._data()).toEqual({ id: 'u1' });
    f.emit({
      kind: 'contact',
      operation: 'created',
      entity: { id: 'c1' },
    } as any);
    expect(s.contacts._data()).toEqual([{ id: 'c1' }]);
    f.emit({
      kind: 'contact',
      operation: 'created',
      entity: { id: 'c1' },
    } as any); // dedup
    expect(s.contacts._data()).toEqual([{ id: 'c1' }]);
    f.emit({ kind: 'contact-deleted', id: 'c1' } as any);
    expect(s.contacts._data()).toEqual([]);
    f.emit({
      kind: 'transaction',
      operation: 'updated',
      entity: { id: 'tx1' },
    } as any); // no throw, no store
  });

  it('onCatchUp refetches all stores', async () => {
    const s = makeStores();
    createFanout(s).onCatchUp();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.accounts.toPromise).toHaveBeenCalled();
    expect(s.user.toPromise).toHaveBeenCalled();
  });
});
